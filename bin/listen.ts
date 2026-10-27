import { Clock, Console, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { reviewLink } from "../src/io/link.ts";
import { HEARTBEAT_MS, ListeningSchema, type Listening } from "../src/io/listening.ts";
import { ageOf, cameLate, wakes, type Command, type Line } from "./lines.ts";
import { markedAbove } from "./agents.ts";
import { changeOf, claim, readFile, writeWhole } from "./wire.ts";

/*
 * `listen` prints each note in the feedback file that this listener has not read yet, then
 * each new one as it comes: one line per note, for a watcher such as Claude Code's Monitor.
 * It claims what it prints (bin/wire.ts), by its name, so a note another reader took never
 * comes here, and a note sent while nobody listened arrives when the agent listens again.
 * A settle wakes no agent: it waits, and comes with the next note, or with the last settle,
 * which ends the review (bin/lines.ts `wakes`). Each line starts with when the note was
 * sent: a note from before the listener started, or one that came late, says so, as the
 * reviewer may have moved on since. While it runs, it says it is there in the listening file
 * beside the feedback file (src/io/listening.ts), so the page can tell the reviewer when no
 * agent reads their notes; it takes its name out again when it stops.
 *
 * `review` checks that the app answers at `--url`, prints the link that opens the review
 * there (src/io/link.ts), and then listens as `listen` does. With no `--journey`, the link
 * opens the page's own review.
 */

/** A new note sent longer ago than this came late: the page or the server held it. */
const LATE_MS = 5 * 60 * 1000;

/** A write the listener can miss: it says so and tries again on its next round. */
const meanwhile = (what: string) =>
  Effect.catch((error: unknown) =>
    Console.error(`[listener] could not write ${what}, tries again: ${String(error)}`),
  );

const ListeningFile = Schema.fromJsonString(ListeningSchema, { space: 1 });

/** Says the listener is there, or with `at` undefined that it has stopped. Another
 *  listener's entry stays as it is; a file that does not read starts again. */
const sayListening = Effect.fn(function* (
  file: string,
  name: string,
  journey: string | undefined,
  at: number | undefined,
) {
  const empty: Listening = {};
  const { [name]: _, ...others } = yield* readFile(file, ListeningFile, empty).pipe(
    Effect.orElseSucceed(() => empty),
  );
  const next = at === undefined ? others : { ...others, [name]: { journey: journey ?? null, at } };
  yield* writeWhole(file, yield* Schema.encodeEffect(ListeningFile)(next));
});

/**
 * The lines a reader took, as the agent reads them: each after a tag that says when it was
 * sent. A settle is only `status`. A note is `old` in the reader's first round, which had
 * the notes from before it listened, `late` when it came long after it was sent, or `new`.
 */
export function tagged(taken: readonly Line[], now: number, first: boolean): string[] {
  return taken.map((line) => {
    const age = ageOf(line.sentAt, now);
    if (!wakes(line)) return `[status, sent ${age}] ${line.raw}`;
    const tag = first
      ? `old, sent ${age}, before you listened`
      : cameLate(line.sentAt, now, LATE_MS)
        ? `late, sent ${age}`
        : `new, sent ${age}`;
    return `[${tag}] ${line.raw}`;
  });
}

/**
 * What a listener takes of its fresh lines: its journey's lines up to the last one that
 * needs the agent. The settles after that one wait, unclaimed, for the next.
 */
export function listenerPick(fresh: readonly Line[], journey: string | undefined) {
  const ours = (l: Line) => journey === undefined || l.journey === journey;
  const last = fresh.reduce((at, l, i) => (ours(l) && wakes(l) ? i : at), -1);
  const held = fresh.slice(last + 1).filter(ours).length;
  if (last < 0) return { take: [], through: undefined, held };
  return { take: fresh.slice(0, last + 1).filter(ours), through: fresh[last]?.id, held };
}

export const listen = Effect.fn(function* (
  feedback: string,
  journey: string | undefined,
  name: string,
) {
  const listening = `${feedback}.listening.json`;
  // It joins its session before it reads a line: it runs until it is stopped, so a hook after
  // its tool call would come too late.
  yield* markedAbove(feedback);
  yield* Effect.addFinalizer(() =>
    sayListening(listening, name, journey, undefined).pipe(Effect.ignore),
  );
  let saidAt = 0;
  let backlog = true;
  // The files at the last round: when they did not change, nothing is new.
  let seen = "";
  for (;;) {
    const now = yield* Clock.currentTimeMillis;
    const change = yield* changeOf(feedback);
    if (change !== seen) {
      let held = 0;
      const taken = yield* claim(feedback, name, (fresh) => {
        const pick = listenerPick(fresh, journey);
        held = pick.held;
        return pick;
      }).pipe(
        Effect.tap(() => Effect.sync(() => (seen = change))),
        Effect.catch((error: unknown) =>
          Console.error(`[listener] could not read the notes, tries again: ${String(error)}`).pipe(
            Effect.as([] as readonly Line[]),
          ),
        ),
      );
      // One write, so the watcher wakes the agent once for a note and the settles before it.
      const printed = tagged(taken, now, backlog);
      if (printed.length > 0) yield* Console.log(printed.join("\n"));
      if (backlog) {
        backlog = false;
        const waiting =
          held === 0
            ? ""
            : `; ${held === 1 ? "1 settle waits" : `${String(held)} settles wait`} for the next note`;
        yield* Console.log(`[listening] ${journey ?? "every journey"}, as ${name}${waiting}`);
      }
    }
    if (now - saidAt >= HEARTBEAT_MS) {
      saidAt = now;
      yield* sayListening(listening, name, journey, now).pipe(meanwhile("the listening file"));
    }
    yield* Effect.sleep("1 second");
  }
});

export const review = Effect.fn(function* (command: Extract<Command, { kind: "review" }>) {
  const link = reviewLink(command.url, command.journey, command.step);
  // The link is no use while the app does not answer.
  yield* HttpClient.head(command.url).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.catch(() =>
      Console.error(
        `No app answers at ${command.url}. Start its dev server, then run review again.`,
      ).pipe(Effect.andThen(Effect.fail("review"))),
    ),
  );
  yield* Console.log(`[review] Send the reviewer this link: ${link}`);
  return yield* Effect.scoped(listen(command.file, command.journey, command.name));
});
