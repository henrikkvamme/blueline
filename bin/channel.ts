#!/usr/bin/env node
/*
 * The agent's side of the channel to the dev tools (src/vite.ts), for an agent that runs
 * apart from the dev server.
 *
 * `listen` prints each note in the feedback file that this listener has not read yet, then
 * each new one as it comes: one line per note, for a watcher such as Claude Code's Monitor.
 * A settle wakes no agent: it waits, and comes with the next note, or with the last settle,
 * which ends the review (bin/lines.ts `wakes`).
 * A read mark per listener, beside the file, keeps the place, so a note sent while nobody
 * listened arrives when the agent listens again. Each line starts with when the note was
 * sent: a note from before the listener started, or one that came late, says so, as the
 * reviewer may have moved on since. While it runs, it says it is there in the listening file
 * beside the feedback file (src/io/listening.ts), so the page can tell the reviewer when no
 * agent reads their notes; it takes its name out again when it stops.
 *
 * `review` starts a review: it checks that the app answers at `--url`, prints the link that
 * opens the review there (src/io/link.ts), and then listens as `listen` does. With no
 * `--journey`, the link opens the page's own review.
 *
 * `reply` answers a note in the status file. It writes the whole file and then renames it,
 * so the page never reads half of it. `--blocks` adds what the reply shows besides its
 * words, from a JSON file with a list of blocks (src/notes/blocks.ts); one that does not
 * read fails, and says where. On `working`, the blocks are the agent's progress, as a plan:
 * each working reply puts its own in place of the last, and the next reply ends it.
 *
 * `apply` takes the reviewer's verdicts on a part's variants from the feedback file and
 * applies them to the code under `--src` (bin/apply.ts): it prints each change, and fails
 * when it cannot tell which variant to keep.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Clock,
  Console,
  Effect,
  FileSystem,
  Path,
  PlatformError,
  Random,
  Schema,
  Stdio,
} from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { reviewLink } from "../src/io/link.ts";
import { HEARTBEAT_MS, ListeningSchema, type Listening } from "../src/io/listening.ts";
import { ReplySchema } from "../src/io/replies.ts";
import { BlockSchema } from "../src/notes/blocks.ts";
import { applyVerdicts, dropPartFields, verdictsIn, type Applied } from "./apply.ts";
import {
  ageOf,
  cameLate,
  commandOf,
  replyAfter,
  takeLines,
  USAGE,
  wakes,
  type Command,
  type Line,
} from "./lines.ts";

/** A new note sent longer ago than this came late: the page or the server held it. */
const LATE_MS = 5 * 60 * 1000;

const writeWhole = Effect.fn(function* (file: string, body: string) {
  const fs = yield* FileSystem.FileSystem;
  // Its own temporary file: listeners and replies write the same files at once.
  const random = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER);
  const temporary = `${file}.tmp.${String(process.pid)}.${random.toString(36)}`;
  yield* fs.writeFileString(temporary, body);
  yield* fs
    .rename(temporary, file)
    .pipe(Effect.tapError(() => fs.remove(temporary).pipe(Effect.ignore)));
});

/** A write the listener can miss: it says so and tries again on its next round. */
const meanwhile = (what: string) =>
  Effect.catch((error: unknown) =>
    Console.error(`[listener] could not write ${what}, tries again: ${String(error)}`),
  );

/** Where each listener read to in the feedback file, in bytes, by its name. */
const MarksFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Int));
/** The answers by note ID. One that is not an answer is kept as it is. */
const StatusFile = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Union([ReplySchema, Schema.Json])),
  { space: 1 },
);
const isReply = Schema.is(ReplySchema);
const BlocksFile = Schema.fromJsonString(Schema.Array(BlockSchema));
const ListeningFile = Schema.fromJsonString(ListeningSchema, { space: 1 });

/** A JSON file as the schema reads it; a missing one is empty. One that does not read
 *  fails, so a reply never writes over another agent's answers. */
const readFile = Effect.fn(function* <A>(file: string, schema: Schema.Codec<A, string>, empty: A) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file))) return empty;
  return yield* Schema.decodeEffect(schema)(yield* fs.readFileString(file));
});

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

const listen = Effect.fn(function* (feedback: string, journey: string | undefined, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const listening = `${feedback}.listening.json`;
  yield* Effect.addFinalizer(() =>
    sayListening(listening, name, journey, undefined).pipe(Effect.ignore),
  );
  let saidAt = 0;
  const marks = `${feedback}.read.json`;
  const read = () => fs.readFile(feedback).pipe(Effect.orElseSucceed(() => new Uint8Array()));
  const kept = (yield* readFile(marks, MarksFile, {}))[name];
  let at = typeof kept === "number" ? kept : 0;
  let backlog = true;
  // Settles that wait for the next line that needs the agent, where each starts in the file.
  let held: Array<{ readonly line: Line; readonly from: number }> = [];
  for (;;) {
    const bytes = yield* read();
    // A mark past the end means the file was started again.
    if (bytes.length < at) {
      at = 0;
      held = [];
    }
    if (bytes.length > at) {
      const { lines, used } = takeLines(bytes.subarray(at));
      const now = yield* Clock.currentTimeMillis;
      for (const line of lines) {
        if (journey !== undefined && line.journey !== journey) continue;
        if (!wakes(line)) {
          held.push({ line, from: at + line.start });
          continue;
        }
        const age = ageOf(line.sentAt, now);
        const tag = backlog
          ? `old, sent ${age}, before you listened`
          : cameLate(line.sentAt, now, LATE_MS)
            ? `late, sent ${age}`
            : `new, sent ${age}`;
        // One write, so the watcher wakes the agent once for the line and the settles before it.
        const before = held.map((h) => `[status, sent ${ageOf(h.line.sentAt, now)}] ${h.line.raw}`);
        yield* Console.log([...before, `[${tag}] ${line.raw}`].join("\n"));
        held = [];
      }
      at += used;
      // The mark stays at the first held settle, so a listener that starts again still has it.
      const mark = held[0]?.from ?? at;
      yield* Effect.gen(function* () {
        const all = yield* readFile(marks, MarksFile, {});
        yield* writeWhole(marks, yield* Schema.encodeEffect(MarksFile)({ ...all, [name]: mark }));
      }).pipe(meanwhile("the read mark"));
    }
    const now = yield* Clock.currentTimeMillis;
    if (now - saidAt >= HEARTBEAT_MS) {
      saidAt = now;
      yield* sayListening(listening, name, journey, now).pipe(meanwhile("the listening file"));
    }
    if (backlog) {
      backlog = false;
      const waiting =
        held.length === 0
          ? ""
          : `; ${held.length === 1 ? "1 settle waits" : `${String(held.length)} settles wait`} for the next note`;
      yield* Console.log(`[listening] ${journey ?? "every journey"}, as ${name}${waiting}`);
    }
    yield* Effect.sleep("1 second");
  }
});

/** Folders with no code of ours. */
const SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git", ".turbo"]);

/** The TypeScript files under the folder, out of the folders with no code of ours. */
const codeIn = Effect.fn(function* (
  dir: string,
): Effect.fn.Return<
  readonly string[],
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: string[] = [];
  for (const name of yield* fs.readDirectory(dir)) {
    const at = path.join(dir, name);
    const info = yield* fs.stat(at);
    if (info.type === "Directory" && !SKIP.has(name)) files.push(...(yield* codeIn(at)));
    else if (info.type === "File" && /\.tsx?$/.test(name) && !name.endsWith(".d.ts"))
      files.push(at);
  }
  return files;
});

const apply = Effect.fn(function* (command: Extract<Command, { kind: "apply" }>) {
  const fs = yield* FileSystem.FileSystem;
  const lines = (yield* fs.readFileString(command.file)).split("\n");
  const verdicts = verdictsIn(lines, command.part);
  if (verdicts === undefined)
    return yield* Console.log(`The reviewer has no verdicts on ${command.part} yet.`);
  const files = yield* codeIn(command.src);
  const sources = yield* Effect.forEach(files, (file) =>
    fs.readFileString(file).pipe(Effect.map((source) => ({ file, source }))),
  );
  const marked = (source: string) => source.includes(command.part);
  const applied: Array<Applied & { readonly file: string; readonly was: string }> = [];
  for (const { file, source } of sources.filter((s) => marked(s.source))) {
    const result = yield* Effect.try({
      try: () => applyVerdicts(file, source, command.part, verdicts, command.keep),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    });
    applied.push({ ...result, file, was: source });
  }
  const resolved = command.keep !== undefined || verdicts.kept.length === 1;
  const changed = applied.filter((a) => a.changes.length > 0);
  if (resolved && changed.length > 0)
    for (const a of applied.filter((a) => a.changes.length === 0))
      changed.push({ ...dropPartFields(a.file, a.was, command.part), file: a.file, was: a.was });
  for (const a of changed.filter((a) => a.changes.length > 0)) {
    yield* writeWhole(a.file, a.source);
    for (const change of a.changes) yield* Console.log(change);
  }
  if (changed.length === 0)
    yield* Console.log(`Nothing to change for ${command.part} under ${command.src}.`);
});

const program = Effect.gen(function* () {
  const command = commandOf(yield* (yield* Stdio.Stdio).args);
  if (command === undefined) {
    yield* Console.error(USAGE);
    return yield* Effect.fail("usage");
  }
  if (command.kind === "listen") {
    return yield* Effect.scoped(listen(command.file, command.journey, command.name));
  }
  if (command.kind === "review") {
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
  }
  if (command.kind === "apply")
    // What the agent must decide, as a plain line, and no stack.
    return yield* apply(command).pipe(
      Effect.catchIf(
        (error) => typeof error === "string",
        (message) => Console.error(message).pipe(Effect.andThen(Effect.fail("apply"))),
      ),
    );
  const blocks =
    command.blocks === undefined
      ? undefined
      : yield* (yield* FileSystem.FileSystem).readFileString(command.blocks).pipe(
          Effect.flatMap(Schema.decodeEffect(BlocksFile)),
          Effect.tapError((error) => Console.error(`The blocks do not read: ${String(error)}`)),
        );
  const all = yield* readFile(command.file, StatusFile, {});
  const was = all[command.id];
  const next = replyAfter(
    isReply(was) ? was : undefined,
    command,
    yield* Clock.currentTimeMillis,
    blocks,
  );
  const body = yield* Schema.encodeEffect(StatusFile)({ ...all, [command.id]: next });
  yield* writeWhole(command.file, `${body}\n`);
});

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
