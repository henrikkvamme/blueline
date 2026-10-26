import { Clock, Effect, FileSystem, Path, Random, Schedule, Schema } from "effect";
import {
  ClaimsSchema,
  claimedBy,
  cursorAtByte,
  freshFor,
  NO_CLAIMS,
  type Claims,
} from "./claims.ts";
import { takeLines, type Line } from "./lines.ts";

/*
 * The agent's side of the feedback file and the status file: whole writes, one lock per
 * file, and claims (bin/claims.ts). Every command that reads lines for an agent claims them
 * here, under the feedback file's lock, so two readers at once never take one line. Every
 * reply writes the status file under its own lock, so two replies at once both stay.
 */

/** Writes the whole file and then renames it in place, so no reader sees half of it. */
export const writeWhole = Effect.fn(function* (file: string, body: string) {
  const fs = yield* FileSystem.FileSystem;
  // Its own temporary file: listeners and replies write the same files at once.
  const random = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER);
  const temporary = `${file}.tmp.${String(process.pid)}.${random.toString(36)}`;
  yield* fs.writeFileString(temporary, body);
  yield* fs
    .rename(temporary, file)
    .pipe(Effect.tapError(() => fs.remove(temporary).pipe(Effect.ignore)));
});

/** A JSON file as the schema reads it; a missing one is empty. One that does not read
 *  fails, so a write never goes over another agent's data. */
export const readFile = Effect.fn(function* <A>(
  file: string,
  schema: Schema.Codec<A, string>,
  empty: A,
) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file))) return empty;
  return yield* Schema.decodeEffect(schema)(yield* fs.readFileString(file));
});

/** A lock left by a process that died: older than any write under a lock takes. */
const STALE_MS = 10_000;

/**
 * Runs `use` while this process holds the file's lock: a folder beside it, which only one
 * process can make. A lock older than STALE_MS is a dead process's, and goes.
 */
export const withLock = <A, E, R>(file: string, use: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const lock = `${file}.lock`;
    // The folder the file goes in, as `.blueline/` before the first note.
    yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
    const take = Effect.gen(function* () {
      const made = yield* fs.makeDirectory(lock).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (made) return;
      const info = yield* fs.stat(lock).pipe(Effect.option);
      const now = yield* Clock.currentTimeMillis;
      const since = info._tag === "Some" ? info.value.mtime : undefined;
      if (since !== undefined && since._tag === "Some" && now - since.value.getTime() > STALE_MS)
        yield* fs.remove(lock, { recursive: true }).pipe(Effect.ignore);
      return yield* Effect.fail(`${lock} is held`);
    });
    yield* take.pipe(
      // About 10 s: longer than any write under a lock takes, and the stale lock goes first.
      Effect.retry({ schedule: Schedule.spaced("25 millis"), times: 400 }),
    );
    return yield* use.pipe(
      Effect.ensuring(fs.remove(lock, { recursive: true }).pipe(Effect.ignore)),
    );
  });

const ClaimsFile = Schema.fromJsonString(ClaimsSchema, { space: 1 });
/** The read marks in bytes, by listener, from before the claims. */
const MarksFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Int));

export const claimsPath = (feedback: string) => `${feedback}.claims.json`;

/** Every whole line in the feedback file; a missing file has none. */
export const feedbackLines = Effect.fn(function* (feedback: string) {
  const fs = yield* FileSystem.FileSystem;
  const bytes = yield* fs.readFile(feedback).pipe(Effect.orElseSucceed(() => new Uint8Array()));
  return takeLines(bytes).lines;
});

/** What a reader takes of its fresh lines: the lines it claims, and the line its cursor goes
 *  past; with none, the cursor stays. */
export interface Pick {
  readonly take: readonly Line[];
  readonly through: string | undefined;
}

/**
 * Claims lines for `reader`, at once for every reader: under the feedback file's lock, it
 * reads the lines after the reader's cursor that no other reader claimed, lets `pick` choose,
 * records the claims and moves the cursor. A reader with a read mark from before the claims
 * starts at that mark.
 */
export const claim = Effect.fn(function* (
  feedback: string,
  reader: string,
  pick: (fresh: readonly Line[]) => Pick,
) {
  return yield* withLock(
    feedback,
    Effect.gen(function* () {
      const lines = yield* feedbackLines(feedback);
      let claims: Claims = yield* readFile(claimsPath(feedback), ClaimsFile, NO_CLAIMS);
      let migrated = false;
      if (claims.cursors[reader] === undefined) {
        const none: Readonly<Record<string, number>> = {};
        const marks = yield* readFile(`${feedback}.read.json`, MarksFile, none).pipe(
          Effect.orElseSucceed(() => none),
        );
        const mark = marks[reader];
        const cursor = mark === undefined ? undefined : cursorAtByte(lines, mark);
        if (cursor !== undefined) {
          claims = { ...claims, cursors: { ...claims.cursors, [reader]: cursor } };
          migrated = true;
        }
      }
      const { take, through } = pick(freshFor(lines, claims, reader));
      // A round with nothing new writes nothing, as a listener reads every second.
      const moved = through !== undefined && through !== claims.cursors[reader];
      if (take.length > 0 || moved || migrated) {
        const next = claimedBy(claims, reader, take, through, yield* Clock.currentTimeMillis);
        yield* writeWhole(claimsPath(feedback), yield* Schema.encodeEffect(ClaimsFile)(next));
      }
      return take;
    }),
  );
});
