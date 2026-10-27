import { Schema } from "effect";

/*
 * Who reads the reviewer's lines (ADR 0005): each agent session that a harness hook, the MCP
 * server or a `blueline` command registered, by session ID, in the agents file beside the
 * feedback file (bin/agents.ts holds the file, its lock and `ps`). This part has no files and
 * no clock, so a test can run it.
 *
 * An agent is `busy` from its prompt until its `Stop` hook lets the turn end, however long
 * the model thinks between hooks; `waiting` during a `wait_for_feedback` call; and `idle`
 * after `Stop`. It is gone once its session ends, or once its harness process no longer runs.
 * No timer decides either. Only a session that joined the review gets its lines, so a session
 * in the same checkout that works on something else never gets them in its turn.
 *
 * A start or a wake from outside (bin/deliver.ts) carries a token in its prompt, and keeps a
 * reservation by it: a joined, busy agent while the session starts. The session's prompt hook
 * finds the token, joins, and takes the reservation's place.
 */

/** A process, with its start time as `ps` says it, so a process ID used again is not it. */
export const ProcessSchema = Schema.Struct({ pid: Schema.Int, started: Schema.String });
export type Process = typeof ProcessSchema.Type;

export const AgentSchema = Schema.Struct({
  harness: Schema.Literals(["claude", "codex"]),
  /** Whether the harness runs under T3 Code. */
  t3: Schema.Boolean,
  process: ProcessSchema,
  state: Schema.Literals(["busy", "waiting", "idle"]),
  /** When the state last changed, in ms. */
  at: Schema.Finite,
  joined: Schema.Boolean,
  /** The last hook, in ms: as near as Blueline can tell to the last model request. */
  request: Schema.Finite,
  /** How long after `request` the agent's prompt cache is warm, in ms (bin/setup.ts). */
  warm: Schema.Finite,
  /** The `Stop` hook's blocks in a row, since the last tool batch. */
  blocks: Schema.Int,
  /** The process of the session's `blueline wait`, while one runs. */
  waiter: Schema.optional(ProcessSchema),
  /** Its T3 thread, once a token gave it. */
  thread: Schema.optional(Schema.String),
});
export type Agent = typeof AgentSchema.Type;

export const ReservationSchema = Schema.Struct({
  adapter: Schema.String,
  /** The start's own process, as `claude -p`; none for a send. */
  process: Schema.optional(ProcessSchema),
  /** The T3 thread the token went to. */
  thread: Schema.optional(Schema.String),
  /** The session a wake sent the token to: the reservation ends when that session is gone. */
  session: Schema.optional(Schema.String),
  /** The lines the start or the wake carried. */
  lines: Schema.Array(Schema.String),
  at: Schema.Finite,
});
export type Reservation = typeof ReservationSchema.Type;

export const AgentsSchema = Schema.Struct({
  sessions: Schema.Record(Schema.String, AgentSchema),
  /** By token. */
  reservations: Schema.Record(Schema.String, ReservationSchema),
});
export type Agents = typeof AgentsSchema.Type;

export const NO_AGENTS: Agents = { sessions: {}, reservations: {} };

/** What a hook knows of its session when it runs. */
export interface Facts {
  readonly session: string;
  readonly harness: Agent["harness"];
  readonly t3: boolean;
  readonly process: Process;
  readonly warm: number;
  readonly now: number;
}

export type HookEvent = "start" | "prompt" | "tool" | "stop" | "end";

/** The prompt's token, from the fixed line a start or a wake puts in it. */
export const tokenLine = (token: string) => `Blueline session ${token}.`;
const TOKEN = /Blueline session ([a-z0-9]{8,})\./;
export const tokenIn = (prompt: string | undefined) => prompt?.match(TOKEN)?.[1];

const fresh = (facts: Facts, was: Agent | undefined): Agent => ({
  harness: facts.harness,
  t3: facts.t3,
  process: facts.process,
  state: was?.state ?? "idle",
  at: was?.at ?? facts.now,
  // A session resumed in the same harness process is the same agent.
  joined: was !== undefined && samePlace(was.process, facts.process) && was.joined,
  request: facts.now,
  warm: facts.warm,
  blocks: was?.blocks ?? 0,
  ...(was?.waiter === undefined ? {} : { waiter: was.waiter }),
  ...(was?.thread === undefined ? {} : { thread: was.thread }),
});

export const samePlace = (a: Process, b: Process) => a.pid === b.pid && a.started === b.started;

const withState = (agent: Agent, state: Agent["state"], now: number): Agent =>
  agent.state === state ? agent : { ...agent, state, at: now };

/**
 * The agents after a hook. `joins` says the hook saw the session join: a `blueline` command
 * in its tool calls, or the token of a reservation in its prompt. `blocked` says the `Stop`
 * hook keeps the turn going, as it gives the session lines.
 */
export function afterHook(
  agents: Agents,
  event: HookEvent,
  facts: Facts,
  seen: { readonly joins?: boolean; readonly token?: string; readonly blocked?: boolean } = {},
): Agents {
  const { session, now } = facts;
  if (event === "end") {
    const { [session]: _, ...others } = agents.sessions;
    return { ...agents, sessions: others };
  }
  let agent = fresh(facts, agents.sessions[session]);
  let reservations = agents.reservations;
  const reserved = seen.token === undefined ? undefined : reservations[seen.token];
  if (seen.token !== undefined && reserved !== undefined) {
    const { [seen.token]: _, ...others } = reservations;
    reservations = others;
    agent = {
      ...agent,
      joined: true,
      ...(reserved.thread === undefined ? {} : { thread: reserved.thread }),
    };
  }
  if (seen.joins === true) agent = { ...agent, joined: true };
  if (event === "start") agent = withState(agent, agents.sessions[session]?.state ?? "idle", now);
  if (event === "prompt" || event === "tool")
    agent = { ...withState(agent, "busy", now), blocks: 0 };
  if (event === "stop")
    agent =
      seen.blocked === true
        ? { ...withState(agent, "busy", now), blocks: agent.blocks + 1 }
        : { ...withState(agent, "idle", now), blocks: 0 };
  return { sessions: { ...agents.sessions, [session]: agent }, reservations };
}

/** The agents with one session's state set, as the MCP server's wait sets it. */
export function withSessionState(
  agents: Agents,
  session: string,
  state: Agent["state"],
  now: number,
  joins: boolean,
): Agents {
  const agent = agents.sessions[session];
  if (agent === undefined) return agents;
  const next = { ...withState(agent, state, now), joined: agent.joined || joins, request: now };
  return { ...agents, sessions: { ...agents.sessions, [session]: next } };
}

/** The session whose harness is the process, if one is. */
export const sessionOf = (agents: Agents, process: Process) =>
  Object.entries(agents.sessions).find(([, a]) => samePlace(a.process, process))?.[0];

/** Whether the `Stop` hook may block once more: the harness ends the turn at its cap anyway,
 * and a block it overrides would take lines that no turn then reads. */
export const mayBlock = (agent: Agent | undefined, cap: number) =>
  agent !== undefined && agent.joined && agent.blocks < cap;

/**
 * The agents whose harness still runs, and the reservations that still may join: a start's
 * process that runs, a wake's session that is there, or a T3 thread, whose run the server
 * checks itself (bin/deliver.ts).
 */
export function liveAgents(agents: Agents, alive: (process: Process) => boolean): Agents {
  const sessions = Object.fromEntries(
    Object.entries(agents.sessions).filter(([, a]) => alive(a.process)),
  );
  const open = (r: Reservation) =>
    r.process !== undefined
      ? alive(r.process)
      : r.session !== undefined
        ? sessions[r.session] !== undefined
        : r.thread !== undefined;
  return {
    sessions,
    reservations: Object.fromEntries(
      Object.entries(agents.reservations).filter(([, r]) => open(r)),
    ),
  };
}
