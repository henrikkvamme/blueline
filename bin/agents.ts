import { execFile } from "node:child_process";
import { Cause, Clock, Console, Effect, Schema } from "effect";
import {
  AgentsSchema,
  liveAgents,
  NO_AGENTS,
  samePlace,
  withSessionState,
  type Agent,
  type Agents,
  type Process,
} from "../src/deliver/agents.ts";
import { readFile, withLock, writeWhole } from "./wire.ts";

/*
 * The agents file beside the feedback file (src/deliver/agents.ts), and the processes it
 * names. Every change of an agent's state is made under the agents file's lock. A step that
 * also claims lines takes the feedback file's lock inside it, never the other way round, so
 * the wake's choice, its claim and a hook's change of state happen in one order.
 */

export const agentsPath = (feedback: string) => `${feedback}.agents.json`;

const AgentsFile = Schema.fromJsonString(AgentsSchema, { space: 1 });

/** Runs `change` on the agents file under its lock, and writes what it returns when that
 * differs. A file that does not read fails, so a write never goes over another's data. */
export const withAgents = <A, E, R>(
  feedback: string,
  change: (agents: Agents) => Effect.Effect<readonly [Agents, A], E, R>,
) =>
  withLock(
    agentsPath(feedback),
    Effect.uninterruptible(
      Effect.gen(function* () {
        const file = agentsPath(feedback);
        const agents = yield* readFile(file, AgentsFile, NO_AGENTS);
        const [next, result] = yield* change(agents);
        if (next !== agents) yield* writeWhole(file, yield* Schema.encodeEffect(AgentsFile)(next));
        return result;
      }),
    ),
  );

/** The agents as the file has them now, without the lock; none for a missing file. */
export const readAgents = (feedback: string) =>
  readFile(agentsPath(feedback), AgentsFile, NO_AGENTS);

/** A process in the system's table: its parent, its start time and its command. */
export interface Row extends Process {
  readonly ppid: number;
  readonly command: string;
}

/** `ps`'s start time is a fixed 24 characters, as `Tue Oct 27 09:43:38 2026`. */
const ROW = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(.*)$/;

/** Every process of the system, by its ID, from one run of `ps`. */
export const processes = Effect.tryPromise({
  try: () =>
    new Promise<ReadonlyMap<number, Row>>((resolve, reject) =>
      execFile(
        "ps",
        ["-A", "-o", "pid=,ppid=,lstart=,comm="],
        { maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
        (error, stdout) => {
          if (error !== null) return reject(error);
          const rows = new Map<number, Row>();
          for (const text of stdout.split("\n")) {
            const match = ROW.exec(text);
            if (match === null) continue;
            const [, pid, ppid, started, command] = match;
            rows.set(Number(pid), {
              pid: Number(pid),
              ppid: Number(ppid),
              started: started ?? "",
              command: command ?? "",
            });
          }
          resolve(rows);
        },
      ),
    ),
  catch: (error) => `ps failed: ${String(error)}`,
});

/** The process's ancestors, its parent first. */
export function ancestorsOf(table: ReadonlyMap<number, Row>, pid: number): readonly Row[] {
  const found: Row[] = [];
  for (let at = table.get(pid)?.ppid; at !== undefined && at > 1; at = table.get(at)?.ppid) {
    const row = table.get(at);
    if (row === undefined || found.includes(row)) break;
    found.push(row);
  }
  return found;
}

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash"]);
const nameOf = (command: string) => command.split("/").at(-1)?.replace(/^-/, "") ?? "";

/** The harness that runs a hook: its first ancestor that is not a shell. */
export const harnessOf = (table: ReadonlyMap<number, Row>, pid: number) =>
  ancestorsOf(table, pid).find((row) => !SHELLS.has(nameOf(row.command)));

/** The session whose harness is an ancestor of the process, as for a command the agent runs
 * or the MCP server it started. */
export function sessionAbove(agents: Agents, table: ReadonlyMap<number, Row>, pid: number) {
  for (const row of ancestorsOf(table, pid)) {
    const found = Object.entries(agents.sessions).find(([, a]) => samePlace(a.process, row));
    if (found !== undefined) return found[0];
  }
  return undefined;
}

/** Whether the process still runs: its ID with the same start time. */
export const aliveIn = (table: ReadonlyMap<number, Row>) => (process: Process) => {
  const row = table.get(process.pid);
  return row !== undefined && row.started === process.started;
};

/** The agents whose harness still runs, by the system's table now. */
export const liveNow = (agents: Agents) =>
  Effect.map(processes, (table) => liveAgents(agents, aliveIn(table)));

/**
 * Joins the session whose harness runs this process, as a command the agent runs or the MCP
 * server it started, and sets its state when one is given. Nothing happens when no session
 * is above it: a harness with no hooks has none.
 */
export const markAbove = (feedback: string, state?: Agent["state"]) =>
  Effect.gen(function* () {
    // A harness with no hooks registers no session: then there is nothing to join, and no
    // `ps` or lock to pay for.
    const before = yield* readAgents(feedback);
    if (Object.keys(before.sessions).length === 0) return undefined;
    const table = yield* processes;
    const now = yield* Clock.currentTimeMillis;
    return yield* withAgents(feedback, (agents) => {
      const session = sessionAbove(agents, table, process.pid);
      if (session === undefined) return Effect.succeed([agents, undefined] as const);
      const agent = agents.sessions[session];
      return Effect.succeed([
        withSessionState(agents, session, state ?? agent?.state ?? "busy", now, true),
        session,
      ] as const);
    });
  });

/** `markAbove` that never fails the command it runs in: it says why on stderr. */
export const markedAbove = (feedback: string, state?: Agent["state"]) =>
  markAbove(feedback, state).pipe(
    Effect.catchCause((cause) =>
      Console.error(`[blueline] could not mark the agent's session: ${Cause.pretty(cause)}`),
    ),
    Effect.asVoid,
  );
