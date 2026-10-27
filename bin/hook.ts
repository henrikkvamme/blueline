import { text } from "node:stream/consumers";
import { Cause, Clock, Console, Effect, Schema } from "effect";
import { afterHook, mayBlock, tokenIn, type Facts, type HookEvent } from "../src/deliver/agents.ts";
import { HOOK_HEADER } from "../src/deliver/words.ts";
import { harnessOf, processes, readAgents, withAgents } from "./agents.ts";
import type { Command, Line } from "./lines.ts";
import { listenerPick, tagged } from "./listen.ts";
import { feedbackOf, repositoryOf } from "./repository.ts";
import { claim } from "./wire.ts";

/*
 * `blueline hook <claude|codex>`: what a harness runs for each of its hooks (ADR 0005). It
 * keeps the session's state in the agents file of each feedback file in its repository
 * (src/deliver/agents.ts), and gives a joined session the reviewer's new lines in its turn:
 * with the prompt, after a tool batch, and at its `Stop`, which it then blocks so the turn
 * goes on. Nothing new prints nothing, so the agent's prompt cache stays whole. A hook never
 * fails the agent's turn: an error goes to stderr, and the hook exits 0.
 */

type HookCommand = Extract<Command, { kind: "hook" }>;

const HookInput = Schema.fromJsonString(
  Schema.Struct({
    session_id: Schema.String,
    cwd: Schema.String,
    hook_event_name: Schema.String,
    prompt: Schema.optional(Schema.String),
    /** Claude's tool batch. */
    tool_calls: Schema.optional(
      Schema.Array(Schema.Struct({ tool_input: Schema.optional(Schema.Unknown) })),
    ),
    /** Codex's one tool. */
    tool_input: Schema.optional(Schema.Unknown),
  }),
);

const EVENTS: Readonly<Record<string, HookEvent>> = {
  SessionStart: "start",
  UserPromptSubmit: "prompt",
  PostToolBatch: "tool",
  PostToolUse: "tool",
  Stop: "stop",
  SessionEnd: "end",
};

/** A tool call that runs a `blueline` command of the review joins its session. */
const JOINS = /\bblueline\s+(review|listen|reply|apply)\b/;
const joinsIn = (inputs: readonly unknown[]) =>
  inputs.some((input) => {
    const command: unknown =
      typeof input === "object" && input !== null ? Reflect.get(input, "command") : undefined;
    return typeof command === "string" && JOINS.test(command);
  });

/** The block cap: Claude Code ends the turn at the ninth `Stop` block in a row. */
const blockCap = (value: string | undefined) => {
  const cap = Number(value);
  return Number.isInteger(cap) && cap > 0 ? cap : 8;
};

/** What the harness reads on stdout, for the event and the lines given. */
export function hookOutput(
  harness: HookCommand["harness"],
  event: HookEvent,
  words: string | undefined,
): string | undefined {
  if (words === undefined) return harness === "codex" && event === "stop" ? "{}" : undefined;
  if (event === "stop") return JSON.stringify({ decision: "block", reason: words });
  const hookEventName =
    event === "prompt"
      ? "UserPromptSubmit"
      : harness === "claude"
        ? "PostToolBatch"
        : "PostToolUse";
  return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: words } });
}

export const hookStep = Effect.fn(function* (command: HookCommand, stdin: string) {
  const input = yield* Schema.decodeEffect(HookInput)(stdin);
  const event = EVENTS[input.hook_event_name];
  if (event === undefined) return undefined;
  const repository = yield* repositoryOf(input.cwd);
  const files =
    command.feedback !== undefined
      ? [command.feedback]
      : repository === undefined
        ? []
        : yield* feedbackOf(repository);
  if (files.length === 0) return hookOutput(command.harness, event, undefined);
  const table = yield* processes;
  const harness = harnessOf(table, process.pid);
  if (harness === undefined) return yield* Effect.fail("The hook finds no harness above it.");
  const named = Number(process.env["CLAUDE_PID"]);
  if (Number.isInteger(named) && named !== harness.pid)
    yield* Console.error(
      `[blueline hook] CLAUDE_PID is ${String(named)}, and the harness above is ${String(harness.pid)}; it takes the harness above.`,
    );
  const now = yield* Clock.currentTimeMillis;
  const facts: Facts = {
    session: input.session_id,
    harness: command.harness,
    t3: process.env["T3CODE_CLI_PATH"] !== undefined,
    process: { pid: harness.pid, started: harness.started },
    warm: command.warmMs,
    now,
  };
  const seen = {
    joins: joinsIn([...(input.tool_calls ?? []).map((c) => c.tool_input), input.tool_input]),
    ...(tokenIn(input.prompt) === undefined ? {} : { token: tokenIn(input.prompt) ?? "" }),
  };
  const cap = blockCap(process.env["CLAUDE_CODE_STOP_HOOK_BLOCK_CAP"]);
  // The harness counts a session's Stop blocks in a row, not a file's: the most that one of
  // its files counts is the count.
  const before = Math.max(
    0,
    ...(yield* Effect.forEach(files, readAgents)).map(
      (agents) => agents.sessions[facts.session]?.blocks ?? 0,
    ),
  );
  const taken: Line[] = [];
  for (const feedback of files)
    yield* withAgents(feedback, (agents) =>
      Effect.gen(function* () {
        const joined = afterHook(agents, event, facts, seen);
        const agent = joined.sessions[facts.session];
        const reads =
          agent?.joined === true &&
          (event === "prompt" ||
            event === "tool" ||
            (event === "stop" && mayBlock({ ...agent, blocks: before }, cap)));
        if (!reads) return [event === "stop" ? agents : joined, undefined] as const;
        const lines = yield* claim(feedback, command.name, (fresh) =>
          listenerPick(fresh, undefined),
        );
        taken.push(...lines);
        // A Stop's state waits until every file has said whether it gives lines.
        return [event === "stop" ? agents : joined, undefined] as const;
      }),
    );
  // The Stop's state in every file: busy when some file gave lines, as the turn goes on.
  if (event === "stop")
    for (const feedback of files)
      yield* withAgents(feedback, (agents) =>
        Effect.succeed([
          afterHook(agents, event, facts, { ...seen, blocked: taken.length > 0, before }),
          undefined,
        ] as const),
      );
  if (taken.length === 0) return hookOutput(command.harness, event, undefined);
  return hookOutput(command.harness, event, [HOOK_HEADER, ...tagged(taken, now, false)].join("\n"));
});

export const hook = Effect.fn(function* (command: HookCommand) {
  const stdin = yield* Effect.promise(() => text(process.stdin));
  const said = yield* hookStep(command, stdin).pipe(
    Effect.catchCause((cause) =>
      Console.error(`[blueline hook] ${Cause.pretty(cause)}`).pipe(Effect.as(undefined)),
    ),
  );
  if (said !== undefined) yield* Console.log(said);
});
