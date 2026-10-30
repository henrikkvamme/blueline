import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { logPath } from "../src/io/log.ts";
import { said } from "./serve.ts";

/*
 * `blueline log`: the review's log (src/io/log.ts), read for an agent that checks whether the
 * review works. By default it gives each note's story in one line: when the reviewer sent it,
 * how long it waited for a reader, for the agent's first word and its reply, and what went
 * wrong, with the steps that opened slowly. `--note` gives every entry of one note, in order.
 */

/** An entry as the log has it: what happened, when, and the fields its writer gave. */
export interface Entry {
  readonly at: number;
  readonly event: string;
  readonly line?: string | undefined;
  readonly note?: string | undefined;
  readonly kind?: string | undefined;
  readonly step?: string | undefined;
  readonly journey?: string | undefined;
  readonly by?: string | undefined;
  readonly state?: string | undefined;
  readonly text?: string | undefined;
  readonly blocks?: readonly string[] | undefined;
  readonly total?: number | undefined;
  readonly phases?: readonly { readonly name: string; readonly ms: number }[] | undefined;
  readonly trouble?: string | undefined;
}

const EntrySchema = Schema.Struct({
  at: Schema.Finite,
  event: Schema.String,
  line: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.String),
  step: Schema.optional(Schema.String),
  journey: Schema.optional(Schema.String),
  by: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  blocks: Schema.optional(Schema.Array(Schema.String)),
  total: Schema.optional(Schema.Finite),
  phases: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, ms: Schema.Finite }))),
  trouble: Schema.optional(Schema.String),
});
const decodeEntry = Schema.decodeUnknownOption(Schema.fromJsonString(EntrySchema));

/** The log's entries, in time order; a line that does not read is skipped. */
export function entriesOf(text: string): Entry[] {
  const entries = text.split("\n").flatMap((raw) => Option.toArray(decodeEntry(raw)));
  return entries.sort((a, b) => a.at - b.at);
}

/** A first reply slower than this is slow. */
export const SLOW_REPLY_MS = 2 * 60_000;
/** A step that takes longer than this to open is slow. */
export const SLOW_STEP_MS = 3_000;

/** A time span in words: 800 ms, 12 s, 4 min, 3 h. */
export function spanOf(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)} h`;
}

const clock = (at: number) => new Date(at).toISOString().replace("T", " ").slice(0, 19);

/** Each entry's note: its own, or the note of the line it names. */
function withNotes(entries: readonly Entry[]): Entry[] {
  const notes = new Map<string, string>();
  for (const e of entries)
    if (e.line !== undefined && e.note !== undefined) notes.set(e.line, e.note);
  return entries.map((e) =>
    e.note !== undefined || e.line === undefined ? e : { ...e, note: notes.get(e.line) },
  );
}

/** One note's story: each message the reviewer sent, and what came of it. */
function storyOf(note: string, entries: readonly Entry[], now: number): string {
  const sent = entries.filter((e) => e.event === "sent");
  const parts: string[] = [];
  const problems: string[] = [];
  for (const [i, message] of sent.entries()) {
    const until = sent[i + 1]?.at ?? Number.POSITIVE_INFINITY;
    const after = entries.filter((e) => e.at >= message.at && e.at < until);
    const claimed = after.find((e) => e.event === "claimed");
    const working = after.find((e) => e.event === "reply" && e.state === "working");
    const replied = after.find((e) => e.event === "reply" && e.state !== "working");
    const lapses = after.filter((e) => e.event === "lapsed").length;
    const word = [working, replied].find((e) => e !== undefined);
    const bits = [
      `sent ${clock(message.at)}`,
      claimed === undefined
        ? "no reader took it"
        : `taken by ${claimed.by ?? "?"} in ${spanOf(claimed.at - message.at)}`,
      working === undefined ? undefined : `working in ${spanOf(working.at - message.at)}`,
      replied === undefined
        ? `no reply after ${spanOf(Math.min(until, now) - message.at)}`
        : `${replied.state ?? "replied"} in ${spanOf(replied.at - message.at)}`,
      lapses === 0 ? undefined : `lapsed ${String(lapses)} time${lapses === 1 ? "" : "s"}`,
    ];
    parts.push(bits.filter((b) => b !== undefined).join(", "));
    if (replied === undefined && until === Number.POSITIVE_INFINITY) problems.push("unanswered");
    if (word !== undefined && word.at - message.at > SLOW_REPLY_MS)
      problems.push("slow first word");
    if (lapses > 0) problems.push("lapsed");
  }
  const flag = problems.length === 0 ? "" : ` [${[...new Set(problems)].join(", ")}]`;
  return `${note}${flag}\n${parts.map((p) => `  ${p}`).join("\n")}`;
}

/** A step's opening on one line: its time, then each phase's. */
const stepLine = (e: Entry) =>
  `  ${clock(e.at)} ${e.journey ?? "?"} / ${e.step ?? "?"}: ${spanOf(e.total ?? 0)}` +
  ` (${(e.phases ?? []).map((p) => `${p.name} ${spanOf(p.ms)}`).join(", ") || "no code"})` +
  (e.trouble === undefined ? "" : ` failed: ${e.trouble}`) +
  ((e.total ?? 0) > SLOW_STEP_MS ? " [slow]" : "");

/** The report `blueline log` prints, for the entries in time order. */
export function reportOf(raw: readonly Entry[], now: number, note?: string): string {
  const entries = withNotes(raw);
  if (note !== undefined) {
    const own = entries.filter((e) => e.note === note);
    if (own.length === 0) return `The log has nothing on ${note}.`;
    const first = own[0]?.at ?? 0;
    return own
      .map((e) => {
        const { at, event, note: _, ...rest } = e;
        const fields = Object.entries(rest)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(" ");
        return `${clock(at)} +${spanOf(at - first)} ${event} ${fields}`.trimEnd();
      })
      .join("\n");
  }
  const notes = [
    ...new Set(
      entries.flatMap((e) => (e.event === "sent" && e.note !== undefined ? [e.note] : [])),
    ),
  ];
  const stories = notes.map((n) =>
    storyOf(
      n,
      entries.filter((e) => e.note === n),
      now,
    ),
  );
  const steps = entries.filter((e) => e.event === "step");
  const sections = [
    stories.length === 0 ? "No notes in the log." : `Notes:\n${stories.join("\n")}`,
    steps.length === 0 ? undefined : `Steps:\n${steps.map(stepLine).join("\n")}`,
  ];
  return sections.filter((s) => s !== undefined).join("\n\n");
}

export const log = (command: { readonly file: string; readonly note: string | undefined }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = logPath(command.file);
    if (!(yield* fs.exists(file)))
      return yield* Console.log(`No log at ${file} yet: Blueline 0.1.16 or later writes it.`);
    const entries = entriesOf(yield* fs.readFileString(file));
    yield* Console.log(reportOf(entries, Date.now(), command.note));
  }).pipe(said("log"));
