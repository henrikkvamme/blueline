import { text } from "node:stream/consumers";
import { Clock, Console, Data, Effect, Runtime, Schema } from "effect";
import { samePlace, type Agents, type Process } from "../src/deliver/agents.ts";
import { HOOK_HEADER } from "../src/deliver/words.ts";
import { aliveIn, processes, withAgents } from "./agents.ts";
import type { Command, Line } from "./lines.ts";
import { listenerPick, tagged } from "./listen.ts";
import { feedbackIn, feedbackOf, repositoryOf } from "./repository.ts";
import { claim } from "./wire.ts";

/*
 * `blueline wait`: Claude Code's idle wake (ADR 0005). Claude Code runs it as a `Stop` hook
 * in the background (`asyncRewake`), and an exit code 2 wakes the session, also when it is
 * idle, with stderr as a reminder in its next turn. While the session is idle and joined, the
 * wait claims its new lines each second, under the agents file's lock, so the server's wake
 * and the session's hooks see one order (bin/agents.ts). With lines, it writes them to stderr
 * and exits 2.
 *
 * It ends with code 0, and wakes nothing, when the session starts a turn of its own, when its
 * harness is gone, when another wait took its place, or when the session's prompt cache is
 * cold: a fresh start then costs less than a wake (ADR 0005), and the server makes it.
 */

type WaitCommand = Extract<Command, { kind: "wait" }>;

const StopInput = Schema.fromJsonString(
  Schema.Struct({ session_id: Schema.String, cwd: Schema.String }),
);

/** The wait's lines: its exit code 2 wakes the session. */
class Woken extends Data.TaggedError("Woken")<{ readonly words: string }> {
  override readonly [Runtime.errorExitCode] = 2;
  override readonly [Runtime.errorReported] = false;
}

/** Why a wait ends without lines, or the lines it took. */
type Round = { readonly kind: "ends"; readonly why: string } | { readonly kind: "lines" };

/** One round on one feedback file, under the agents file's lock. */
const roundOn = Effect.fn(function* (
  feedback: string,
  command: WaitCommand,
  session: string,
  me: Process,
  since: number,
  taken: Line[],
) {
  const table = yield* processes;
  const alive = aliveIn(table);
  return yield* withAgents(feedback, (agents) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const agent = agents.sessions[session];
      const ends = (why: string): readonly [Agents, Round] => {
        if (agent?.waiter === undefined || !samePlace(agent.waiter, me))
          return [agents, { kind: "ends", why }];
        const { waiter: _, ...rest } = agent;
        return [
          { ...agents, sessions: { ...agents.sessions, [session]: rest } },
          { kind: "ends", why },
        ];
      };
      if (agent === undefined || !alive(agent.process)) return ends("the session is gone");
      if (agent.waiter !== undefined && !samePlace(agent.waiter, me) && alive(agent.waiter))
        return [agents, { kind: "ends", why: "another wait runs" }] as const;
      if (agent.state !== "idle" && agent.at > since) return ends("the session is in a turn");
      if (now - agent.request > agent.warm) return ends("the session's cache is cold");
      // A wait whose process is gone left its place: this one takes it.
      const mine =
        agent.waiter !== undefined && samePlace(agent.waiter, me)
          ? agent
          : { ...agent, waiter: me };
      const next =
        mine === agent ? agents : { ...agents, sessions: { ...agents.sessions, [session]: mine } };
      if (agent.state !== "idle" || !agent.joined) return [next, { kind: "lines" }] as const;
      const lines = yield* claim(feedback, command.name, (fresh) => listenerPick(fresh, undefined));
      if (lines.length === 0) return [next, { kind: "lines" }] as const;
      taken.push(...lines);
      // The wake ends this wait: the session's next `Stop` starts the next one.
      return ends("it woke the session");
    }),
  );
});

export const waitStep = Effect.fn(function* (command: WaitCommand, stdin: string) {
  const input = yield* Schema.decodeEffect(StopInput)(stdin);
  const repository = yield* repositoryOf(input.cwd);
  const files =
    command.feedback !== undefined
      ? [feedbackIn(repository, command.feedback)]
      : repository === undefined
        ? []
        : yield* feedbackOf(repository);
  if (files.length === 0) return "no feedback file";
  const own = (yield* processes).get(process.pid);
  if (own === undefined) return yield* Effect.fail("The wait does not find its own process.");
  const me: Process = { pid: own.pid, started: own.started };
  const since = yield* Clock.currentTimeMillis;
  for (;;) {
    const taken: Line[] = [];
    for (const feedback of files) {
      const round = yield* roundOn(feedback, command, input.session_id, me, since, taken);
      if (round.kind === "ends" && taken.length === 0) return round.why;
      if (round.kind === "ends") break;
    }
    if (taken.length > 0) {
      const now = yield* Clock.currentTimeMillis;
      return yield* new Woken({ words: [HOOK_HEADER, ...tagged(taken, now, false)].join("\n") });
    }
    yield* Effect.sleep("1 second");
  }
});

export const wait = Effect.fn(function* (command: WaitCommand) {
  const stdin = yield* Effect.promise(() => text(process.stdin));
  return yield* waitStep(command, stdin).pipe(
    Effect.tapError((error) => (error instanceof Woken ? Console.error(error.words) : Effect.void)),
    Effect.catchIf(
      (error) => !(error instanceof Woken),
      (error) => Console.error(`[blueline wait] ${String(error)}`),
    ),
    Effect.asVoid,
  );
});
