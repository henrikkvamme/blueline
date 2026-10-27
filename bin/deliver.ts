import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { Cause, Clock, Console, Effect, FileSystem, Path, Schema } from "effect";
import {
  liveAgents,
  tokenLine,
  withStarted,
  type Agents,
  type Reservation,
} from "../src/deliver/agents.ts";
import { wakeFor, type Wake } from "../src/deliver/wake.ts";
import { HOOK_HEADER } from "../src/deliver/words.ts";
import { ListeningSchema, SILENT_MS, HEARTBEAT_MS } from "../src/io/listening.ts";
import { aliveIn, processes, readAgents, withAgents } from "./agents.ts";
import { wakes, type Line } from "./lines.ts";
import { listenerPick, tagged } from "./listen.ts";
import { PLACE } from "./repository.ts";
import { changeOf, claim, readFile, unclaim, writeWhole } from "./wire.ts";

/*
 * The wake, in `blueline serve` (ADR 0005). Each second, for each app the server keeps, it
 * looks for the reviewer's lines that no agent took. Once the feedback file has been quiet
 * for a few seconds, it decides by the app's live agents (src/deliver/wake.ts): nothing, as
 * an agent that works takes its lines itself; a wake of an idle agent from outside; or a
 * fresh agent, by the repository's start adapter.
 *
 * The choice, its claim and its reservation happen in one step under the agents file's lock
 * (bin/agents.ts), as each hook's change of state does. The send runs after, outside the
 * lock; when it fails, the lines go back (`unclaim`) and the reservation ends. A start or a
 * wake carries a token in its prompt, and the session's prompt hook joins it by the token.
 */

/** How long a feedback file is quiet before the server acts: a burst of lines is one wake. */
const QUIET_MS = 5_000;
/** The server's own name in the listening file. */
export const SERVER_LISTENER = "blueline-serve";

/** How the repository starts a fresh agent; `blueline setup --start` writes it. */
const StartSchema = Schema.Union([
  Schema.Struct({
    adapter: Schema.Literal("t3"),
    provider: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
  }),
  Schema.Struct({ adapter: Schema.Literal("claude"), model: Schema.optional(Schema.String) }),
  Schema.Struct({ adapter: Schema.Literal("codex"), model: Schema.optional(Schema.String) }),
  Schema.Struct({ adapter: Schema.Literal("command"), command: Schema.Array(Schema.String) }),
]);
export type Start = typeof StartSchema.Type;

export const StartsSchema = Schema.Record(
  Schema.String,
  Schema.Struct({
    start: Schema.optional(StartSchema),
    /** The reader name the repository's agents use, as setup wrote it. */
    as: Schema.optional(Schema.String),
  }),
);
export type Starts = typeof StartsSchema.Type;
export const StartsFile = Schema.fromJsonString(StartsSchema, { space: 1 });
export const startsPath = (state: string) => `${state}/start.json`;

const KeptApps = Schema.fromJsonString(
  Schema.Struct({
    apps: Schema.Array(
      Schema.Struct({
        root: Schema.String,
        repository: Schema.String,
        files: Schema.Struct({
          feedback: Schema.String,
          status: Schema.String,
          listening: Schema.String,
        }),
      }),
    ),
  }),
);
type KeptApp = (typeof KeptApps.Type)["apps"][number];

const ListeningFile = Schema.fromJsonString(ListeningSchema, { space: 1 });

/** A command's end: its code and what it printed. */
interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const run = (command: string, args: readonly string[], cwd: string, input?: string) =>
  Effect.callback<Ran>((resume) => {
    const child = execFile(
      command,
      args,
      { cwd, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resume(
          Effect.succeed({
            code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
            stdout,
            stderr,
          }),
        ),
    );
    if (input !== undefined) child.stdin?.end(input);
  });

/** Starts a process of its own, which outlives the server's round, with its output in the
 * log file; its ID, or a reason. The log opens only for a start, so a server that starts no
 * agent writes no log. */
const launch = (
  command: string,
  args: readonly string[],
  cwd: string,
  log: string,
  input?: string,
) =>
  Effect.callback<number, string>((resume) => {
    let fd: number;
    try {
      fd = openSync(log, "a");
    } catch (error) {
      resume(Effect.fail(`${log} does not open: ${String(error)}`));
      return;
    }
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: [input === undefined ? "ignore" : "pipe", fd, fd],
    });
    // The child holds its own copy of the file.
    closeSync(fd);
    child.once("error", (error) => resume(Effect.fail(error.message)));
    child.once("spawn", () => {
      if (input !== undefined) child.stdin?.end(input);
      child.unref();
      resume(child.pid === undefined ? Effect.fail("no process ID") : Effect.succeed(child.pid));
    });
  });

/** The words a fresh agent starts with: they stand alone, as it knows nothing yet. */
export function startNote(token: string, app: KeptApp, lines: readonly string[], blueline: string) {
  const { feedback, status } = app.files;
  return [
    tokenLine(token),
    `You are the agent for a Blueline review of the app in ${app.root}. The reviewer wrote the lines below in the review panel.`,
    `Answer each line with an id: run \`${blueline} reply ${status} <id> working\` as you start, make the change, then run \`${blueline} reply ${status} <id> replied "<what you did>"\`. Or use the reply tool of the blueline MCP server.`,
    `Then wait for the next lines: call wait_for_feedback, or run \`${blueline} listen ${feedback}\`.`,
    "",
    ...lines,
  ].join("\n");
}

/** The \`blueline\` command as a fresh agent's shell runs it: the app's own, or the
 * repository's, as no \`blueline\` may be on its PATH; else this command. */
const bluelineIn = Effect.fn(function* (app: KeptApp) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const folder of [app.root, app.repository]) {
    const local = path.join(folder, "node_modules", ".bin", "blueline");
    if (yield* fs.exists(local)) return local;
  }
  const script = process.argv[1];
  return script === undefined ? "blueline" : `${process.execPath} ${script}`;
});

/** The words that wake an agent that knows the review. */
export const wakeNote = (token: string, lines: readonly string[]) =>
  [tokenLine(token), HOOK_HEADER, ...lines].join("\n");

/** Whether a listener other than the server said it is there just now. */
const listenedNow = (listening: string, now: number) =>
  readFile(listening, ListeningFile, {}).pipe(
    Effect.orElseSucceed(() => ({})),
    Effect.map((all) =>
      Object.entries(all).some(([name, l]) => name !== SERVER_LISTENER && now - l.at <= SILENT_MS),
    ),
  );

/** The t3 command: on the path, or where T3 Code puts it. */
const t3Command = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { HOME } = process.env;
  const placed = HOME === undefined ? undefined : `${HOME}/.t3/bin/t3`;
  return placed !== undefined && (yield* fs.exists(placed)) ? placed : "t3";
});

/** What the round decided for one app, and what it claimed for it. */
interface Decided {
  readonly wake: Wake;
  readonly taken: readonly Line[];
  readonly token: string;
  /** The T3 thread a wake sends to. */
  readonly thread: string | undefined;
  /** Whether a start or a wake from before ended with no session joined. */
  readonly failed: boolean;
}

/** One app's round: the choice, its claim and its reservation, under the agents file's lock. */
const decide = Effect.fn(function* (
  app: KeptApp,
  name: string,
  start: Start | undefined,
  ended: ReadonlySet<string>,
  /** A start failed and no line came since: the server does not start again yet. */
  paused: boolean,
) {
  const now = yield* Clock.currentTimeMillis;
  const listened = yield* listenedNow(app.files.listening, now);
  const table = yield* processes;
  const alive = aliveIn(table);
  const token = randomBytes(6).toString("hex");
  return yield* withAgents(app.files.feedback, (agents) =>
    Effect.gen(function* () {
      const live = liveAgents(agents, alive);
      // A T3 thread whose run ended with no session joined is a start that failed.
      const open = Object.fromEntries(
        Object.entries(live.reservations).filter(
          ([, r]) => r.thread === undefined || !ended.has(r.thread),
        ),
      );
      const kept: Agents = { sessions: live.sessions, reservations: open };
      // A reservation that ends with no session joined is a start or a wake that failed: its
      // lines go back, so this round can try again.
      const failed = Object.entries(agents.reservations).filter(
        ([token]) => open[token] === undefined,
      );
      for (const [, r] of failed) yield* unclaim(app.files.feedback, name, r.lines);
      if (failed.length > 0 || paused) {
        const held: Decided = {
          wake: { kind: "none", why: "a start failed" },
          taken: [],
          token,
          thread: undefined,
          failed: failed.length > 0,
        };
        return [kept, held] as const;
      }
      // The choice is made in the claim, under the feedback file's lock too.
      const chosen: { wake: Wake } = { wake: { kind: "none", why: "nothing new" } };
      const taken = yield* claim(app.files.feedback, name, (fresh) => {
        const pick = listenerPick(fresh, undefined);
        if (!pick.take.some(wakes)) return { take: [], through: undefined };
        const wake = wakeFor({ agents: kept, alive, listened, now });
        chosen.wake =
          wake.kind === "start" && start === undefined
            ? { kind: "none", why: "no start adapter is set" }
            : wake;
        return chosen.wake.kind === "none" ? { take: [], through: undefined } : pick;
      });
      const { wake } = chosen;
      if (taken.length === 0) {
        const same =
          Object.keys(kept.sessions).length === Object.keys(agents.sessions).length &&
          Object.keys(kept.reservations).length === Object.keys(agents.reservations).length;
        return [
          same ? agents : kept,
          { wake, taken, token, thread: undefined, failed: false },
        ] as const;
      }
      const thread = wake.kind === "wake" ? kept.sessions[wake.session]?.thread : undefined;
      const reservation: Reservation = {
        adapter: wake.kind === "wake" ? wake.via : (start?.adapter ?? "none"),
        ...(wake.kind === "wake" ? { session: wake.session } : {}),
        ...(thread === undefined ? {} : { thread }),
        lines: taken.map((l) => l.id),
        at: now,
      };
      return [
        { ...kept, reservations: { ...kept.reservations, [token]: reservation } },
        { wake, taken, token, thread, failed: false },
      ] as const;
    }),
  );
});

/** Ends a reservation, and gives its lines back: the start or the send failed. It says that
 * it failed, so the server waits for a new line before it tries again. */
const undo = Effect.fn(function* (app: KeptApp, name: string, decided: Decided, why: string) {
  yield* Console.error(`[deliver] ${app.root}: ${why}; the lines go back.`);
  yield* unclaim(
    app.files.feedback,
    name,
    decided.taken.map((l) => l.id),
  );
  yield* withAgents(app.files.feedback, (agents) => {
    const { [decided.token]: _, ...others } = agents.reservations;
    return Effect.succeed([{ ...agents, reservations: others }, undefined] as const);
  });
  return true;
});

/** Keeps what the start made, its process or its thread, by its token. */
const keepStarted = (app: KeptApp, token: string, made: Partial<Reservation>) =>
  withAgents(app.files.feedback, (agents) =>
    Effect.succeed([withStarted(agents, token, made), undefined] as const),
  );

/** Acts on the choice, outside the lock; whether the start or the send failed. */
const act = Effect.fn(function* (
  app: KeptApp,
  name: string,
  start: Start | undefined,
  decided: Decided,
  log: string,
) {
  const { wake, taken, token } = decided;
  const now = yield* Clock.currentTimeMillis;
  const lines = tagged(taken, now, false);
  if (wake.kind === "wake") {
    const note = wakeNote(token, lines);
    const sent =
      wake.via === "codex"
        ? yield* run("codex", ["queue", "--thread", wake.session, "--message", note], app.root)
        : yield* run(
            yield* t3Command,
            ["thread", "send", decided.thread ?? "", "-"],
            app.root,
            note,
          );
    if (sent.code !== 0)
      return yield* undo(app, name, decided, `the wake failed: ${sent.stderr.trim()}`);
    yield* Console.error(`[deliver] ${app.root}: woke ${wake.session} by ${wake.via}.`);
    return false;
  }
  if (wake.kind !== "start") return false;
  if (start === undefined) return yield* undo(app, name, decided, "no start adapter is set");
  const note = startNote(token, app, lines, yield* bluelineIn(app));
  if (start.adapter === "t3") {
    const t3 = yield* t3Command;
    const options = [
      ...(start.provider === undefined ? [] : ["--provider", start.provider]),
      ...(start.model === undefined ? [] : ["--model", start.model]),
    ];
    // Its title names the review: the note's first line is the token.
    const title = `Blueline review of ${app.root.split("/").at(-1) ?? app.root}`;
    const made = yield* run(
      t3,
      ["thread", "start", "--title", title, ...options, app.repository, note],
      app.root,
    );
    const thread = made.stdout.trim().split("\n").at(-1)?.trim() ?? "";
    if (made.code !== 0 || thread === "")
      return yield* undo(app, name, decided, `t3 could not start a thread: ${made.stderr.trim()}`);
    yield* keepStarted(app, token, { thread });
    yield* Console.error(`[deliver] ${app.root}: started T3 thread ${thread}.`);
    return false;
  }
  const [command, args, input]: readonly [string, readonly string[], string | undefined] =
    start.adapter === "claude"
      ? [
          "claude",
          ["-p", note, ...(start.model === undefined ? [] : ["--model", start.model])],
          undefined,
        ]
      : start.adapter === "codex"
        ? [
            "codex",
            ["exec", ...(start.model === undefined ? [] : ["--model", start.model]), note],
            undefined,
          ]
        : [start.command[0] ?? "", start.command.slice(1), note];
  const pid = yield* launch(command, args, app.root, log, input).pipe(
    Effect.catch((why) =>
      undo(app, name, decided, `${start.adapter} did not start: ${why}`).pipe(Effect.as(undefined)),
    ),
  );
  if (pid === undefined) return true;
  const started = (yield* processes).get(pid)?.started;
  if (started !== undefined) yield* keepStarted(app, token, { process: { pid, started } });
  yield* Console.error(
    `[deliver] ${app.root}: started ${start.adapter} as process ${String(pid)}.`,
  );
  return false;
});

/** The T3 threads whose run ended: a start there that no session joined has failed. */
const endedThreads = Effect.fn(function* (threads: readonly string[], cwd: string) {
  if (threads.length === 0) return new Set<string>();
  const t3 = yield* t3Command;
  const ended = new Set<string>();
  for (const thread of threads) {
    const shown = yield* run(t3, ["thread", "show", thread, "--json"], cwd);
    const state = yield* Schema.decodeEffect(
      Schema.fromJsonString(
        Schema.Struct({
          thread: Schema.Struct({
            runCount: Schema.Finite,
            activeRunId: Schema.NullOr(Schema.String),
          }),
        }),
      ),
    )(shown.stdout).pipe(Effect.option);
    if (
      state._tag === "Some" &&
      state.value.thread.runCount > 0 &&
      state.value.thread.activeRunId === null
    )
      ended.add(thread);
  }
  return ended;
});

/** Says in the app's listening file that the server reads its lines, while it can start an
 * agent or a joined one is there: a joined agent may think for minutes between hooks. */
const sayServed = Effect.fn(function* (app: KeptApp, now: number) {
  const all = yield* readFile(app.files.listening, ListeningFile, {}).pipe(
    Effect.orElseSucceed(() => ({})),
  );
  yield* writeWhole(
    app.files.listening,
    yield* Schema.encodeEffect(ListeningFile)({
      ...all,
      [SERVER_LISTENER]: { journey: null, at: now },
    }),
  );
});

/** The wake's loop, for as long as the server runs. Each app's round runs on its own: one
 * that fails says why, and the others go on. */
export const deliver = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { state } = yield* PLACE;
  yield* fs.makeDirectory(state, { recursive: true });
  // The started agents' output, apart from the server's own log.
  const log = path.join(state, "agents.log");
  const quiet = new Map<string, { readonly change: string; readonly since: number }>();
  /** By feedback file: its size when a start there failed. */
  const failedAt = new Map<string, string>();
  let saidAt = 0;
  for (;;) {
    const now = yield* Clock.currentTimeMillis;
    const appsFile = path.join(state, "apps.json");
    const kept = (yield* fs.exists(appsFile))
      ? yield* fs.readFileString(appsFile).pipe(
          Effect.flatMap(Schema.decodeEffect(KeptApps)),
          Effect.orElseSucceed(() => ({ apps: [] })),
        )
      : { apps: [] };
    const starts = yield* readFile(startsPath(state), StartsFile, {}).pipe(
      Effect.orElseSucceed((): Starts => ({})),
    );
    const beat = now - saidAt >= HEARTBEAT_MS;
    if (beat) saidAt = now;
    for (const app of kept.apps) {
      const setting = starts[app.repository];
      const name = setting?.as ?? "agent";
      yield* Effect.gen(function* () {
        const change = yield* changeOf(app.files.feedback);
        if (quiet.get(app.files.feedback)?.change !== change)
          quiet.set(app.files.feedback, { change, since: now });
        const agents = yield* readAgents(app.files.feedback);
        const joined = Object.values(agents.sessions).some((a) => a.joined);
        if (beat && (setting?.start !== undefined || joined)) yield* sayServed(app, now);
        if (now - (quiet.get(app.files.feedback)?.since ?? now) < QUIET_MS) return;
        const threads = Object.values(agents.reservations).flatMap((r) =>
          r.thread === undefined || r.session !== undefined ? [] : [r.thread],
        );
        const ended = yield* endedThreads(threads, app.root);
        const size = change.split(" ")[0] ?? "";
        const paused = failedAt.get(app.files.feedback) === size;
        const decided = yield* decide(app, name, setting?.start, ended, paused);
        // A start that failed is not tried again on the same lines: the next line tries again.
        if (decided.failed) {
          failedAt.set(app.files.feedback, size);
          yield* Console.error(
            `[deliver] ${app.root}: the agent ended before it joined; the next line starts one again.`,
          );
        } else if (!paused) failedAt.delete(app.files.feedback);
        if (decided.taken.length > 0 && (yield* act(app, name, setting?.start, decided, log)))
          failedAt.set(app.files.feedback, size);
      }).pipe(
        Effect.catchCause((cause) =>
          Console.error(`[deliver] ${app.root}: ${Cause.pretty(cause)}`),
        ),
      );
    }
    yield* Effect.sleep("1 second");
  }
});
