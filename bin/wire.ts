import { DatabaseSync } from "node:sqlite";
import {
  Clock,
  Effect,
  FileSystem,
  Path,
  PlatformError,
  Random,
  Schedule,
  Schema,
  Semaphore,
} from "effect";
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
 * file (`withLock`), and claims (bin/claims.ts). Every command that reads lines for an agent claims them
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

const isMissing = (error: PlatformError.PlatformError) => error.reason._tag === "NotFound";

/** Each lock's queue in this process, by the lock's path. */
const queues = new Map<string, Semaphore.Semaphore>();

const queueOf = (lock: string) => {
  const known = queues.get(lock);
  if (known !== undefined) return known;
  const made = Semaphore.makeUnsafe(1);
  queues.set(lock, made);
  return made;
};

/**
 * Opens the lock's database and starts a write transaction on it, which SQLite lets only one
 * connection hold. Fails at once while another process holds it.
 */
const openLock = (lock: string) =>
  Effect.try({
    try: () => {
      const db = new DatabaseSync(lock, { timeout: 0 });
      try {
        db.exec("BEGIN IMMEDIATE");
        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    },
    catch: () => `${lock} is held`,
  });

const closeLock = (db: DatabaseSync) =>
  Effect.sync(() => {
    try {
      db.exec("ROLLBACK");
    } finally {
      db.close();
    }
  });

/**
 * Runs `use` while this process holds the file's lock: a write transaction on a SQLite
 * database beside it. The system frees the lock when its process ends, also when it is
 * killed, so no lock is ever left behind and no process has to break one. A slow holder keeps
 * its lock. In one process, the fibers queue for it first, so they do not spin on it.
 * Taking the lock and giving it up cannot be interrupted between them.
 */
export const withLock = <A, E, R>(file: string, use: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const lock = `${file}.lock`;
    // The folder the file goes in, as `.blueline/` before the first note.
    yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
    // About 10 s, then it fails and says so: a live process holds it that long only if stuck.
    const take = openLock(lock).pipe(
      Effect.retry({ schedule: Schedule.spaced("25 millis"), times: 400 }),
    );
    return yield* queueOf(lock).withPermit(Effect.acquireUseRelease(take, () => use, closeLock));
  });

const ClaimsFile = Schema.fromJsonString(ClaimsSchema, { space: 1 });
/** The read marks in bytes, by listener, from before the claims. */
const MarksFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Int));

export const claimsPath = (feedback: string) => `${feedback}.claims.json`;

/** The feedback file's bytes; a missing file has none. Any other failure fails, so a reader
 * tries again rather than take a failed read for an empty file. */
const feedbackBytes = Effect.fn(function* (feedback: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFile(feedback)
    .pipe(Effect.catchIf(isMissing, () => Effect.succeed(new Uint8Array())));
});

/** Every whole line in the feedback file; a missing file has none. */
export const feedbackLines = Effect.fn(function* (feedback: string) {
  return takeLines(yield* feedbackBytes(feedback)).lines;
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
      const bytes = yield* feedbackBytes(feedback);
      const lines = takeLines(bytes).lines;
      let claims: Claims = yield* readFile(claimsPath(feedback), ClaimsFile, NO_CLAIMS);
      let migrated = false;
      if (claims.cursors[reader] === undefined) {
        const none: Readonly<Record<string, number>> = {};
        const marks = yield* readFile(`${feedback}.read.json`, MarksFile, none).pipe(
          Effect.orElseSucceed(() => none),
        );
        const mark = marks[reader];
        // A mark past the end means the file was started again: every line is new.
        const cursor =
          mark === undefined || mark > bytes.length ? undefined : cursorAtByte(lines, mark);
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
