import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Clock,
  Effect,
  FileSystem,
  Path,
  PlatformError,
  Random,
  Option,
  Schema,
  Semaphore,
} from "effect";
import {
  answeredAt,
  ClaimsSchema,
  claimedBy,
  cursorAtByte,
  freshFor,
  givenBack,
  lapsed,
  laterOf,
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
 * connection hold; undefined at once while another holds it. It does not wait.
 */
const openLock = (lock: string) =>
  Effect.sync(() => {
    const db = new DatabaseSync(lock, { timeout: 0 });
    try {
      db.exec("BEGIN IMMEDIATE");
      return db;
    } catch {
      db.close();
      return undefined;
    }
  });

const closeLock = (db: DatabaseSync | undefined) =>
  Effect.sync(() => {
    if (db === undefined) return;
    try {
      db.exec("ROLLBACK");
    } finally {
      db.close();
    }
  });

/** How long to wait between tries, and how many: about 10 s, then it fails and says so. A live
 * process holds the lock that long only if it is stuck. */
const RETRY = { every: "25 millis", times: 400 } as const;

/**
 * Runs `use` while this process holds the file's lock: a write transaction on a SQLite
 * database beside it. The system frees the lock when its process ends, also when it is
 * killed, so no lock is ever left behind and no process has to break one. A slow holder keeps
 * its lock. In one process, the fibers queue for it first, so they do not spin on it.
 * Each try takes the lock and sets up its release in one step that an interrupt cannot
 * split; the waits between tries can be interrupted.
 */
export const withLock = <A, E, R>(file: string, use: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const lock = `${file}.lock`;
    // The folder the file goes in, as `.blueline/` before the first note.
    yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
    const once = Effect.acquireUseRelease(
      openLock(lock),
      (db) => (db === undefined ? Effect.succeedNone : Effect.asSome(use)),
      closeLock,
    );
    return yield* queueOf(lock).withPermit(
      Effect.gen(function* () {
        for (let tries = 0; ; tries += 1) {
          const done = yield* once;
          if (Option.isSome(done)) return done.value;
          if (tries >= RETRY.times) return yield* Effect.fail(`${lock} is held`);
          yield* Effect.sleep(RETRY.every);
        }
      }),
    );
  });

const ClaimsFile = Schema.fromJsonString(ClaimsSchema, { space: 1 });
/** The read marks in bytes, by listener, from before the claims. */
const MarksFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Int));

export const claimsPath = (feedback: string) => `${feedback}.claims.json`;

/** The times of the agent's answers in the status file beside the feedback file, by note: all
 * a claim's lapse reads. An entry that is not an answer has none. */
const AnswerTimes = Schema.Struct({
  workingAt: Schema.optional(Schema.Finite),
  settledAt: Schema.optional(Schema.Finite),
  replies: Schema.optional(Schema.Array(Schema.Struct({ at: Schema.optional(Schema.Finite) }))),
});
const decodeAnswer = Schema.decodeUnknownOption(AnswerTimes);
const StatusEntries = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

/** Whether the note has an answer since a time, by the status file; undefined when the file
 * does not read, so no claim lapses on a failed read. */
const answersBeside = (feedback: string) =>
  readFile(path.join(path.dirname(feedback), "status.json"), StatusEntries, {}).pipe(
    Effect.map(
      (entries) => (note: string, since: number) =>
        answeredAt(Option.getOrUndefined(decodeAnswer(entries[note])), since),
    ),
    Effect.orElseSucceed(() => undefined),
  );

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
 * reads the lines after the reader's cursor that no other reader claimed, and the lines given
 * back, lets `pick` choose, records the claims and moves the cursor. A reader with a read
 * mark from before the claims starts at that mark.
 *
 * The work under the lock cannot be interrupted, so a claim is whole or none. `claimed` gets
 * the lines taken as soon as they are written, in that same part: a reader that is stopped
 * after it still knows what it holds, and can give it back (`unclaim`).
 */
export const claim = Effect.fn(function* (
  feedback: string,
  reader: string,
  pick: (fresh: readonly Line[]) => Pick,
  claimed?: (taken: readonly Line[]) => void,
) {
  return yield* withLock(
    feedback,
    Effect.uninterruptible(
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
        // A claim with no answer in its lease is given back first, to every reader.
        const now = yield* Clock.currentTimeMillis;
        const answered = yield* answersBeside(feedback);
        const kept = claims;
        if (answered !== undefined) claims = lapsed(lines, claims, answered, now);
        const picked = pick(freshFor(lines, claims, reader));
        const { take } = picked;
        const through = laterOf(lines, claims.cursors[reader], picked.through);
        // A round with nothing new writes nothing, as a listener reads every second.
        const moved = through !== undefined && through !== claims.cursors[reader];
        if (take.length > 0 || moved || migrated || claims !== kept) {
          const next = claimedBy(claims, reader, take, through, now);
          yield* writeWhole(claimsPath(feedback), yield* Schema.encodeEffect(ClaimsFile)(next));
          if (take.length > 0) claimed?.(take);
        }
        return take;
      }),
    ),
  );
});

/** Gives back the lines `ids` that `reader` claimed and could not deliver (bin/claims.ts
 * `givenBack`). Lines it no longer holds stay as they are. */
export const unclaim = Effect.fn(function* (
  feedback: string,
  reader: string,
  ids: readonly string[],
) {
  yield* withLock(
    feedback,
    Effect.uninterruptible(
      Effect.gen(function* () {
        const claims = yield* readFile(claimsPath(feedback), ClaimsFile, NO_CLAIMS);
        const next = givenBack(claims, reader, ids, yield* Clock.currentTimeMillis);
        if (next !== claims)
          yield* writeWhole(claimsPath(feedback), yield* Schema.encodeEffect(ClaimsFile)(next));
      }),
    ),
  );
});

/** What a reader that polls compares between rounds: the feedback file's size, and the
 * claims file's place on disk, size and time, as a line given back changes only the claims.
 * Each write of the claims is a new file (`writeWhole`), so its place changes with it. A file
 * that is missing counts as empty. */
export const changeOf = Effect.fn(function* (feedback: string) {
  const fs = yield* FileSystem.FileSystem;
  const mark = (file: string) =>
    fs.stat(file).pipe(
      Effect.map((info) =>
        [
          Option.getOrUndefined(info.ino),
          info.size,
          Option.getOrUndefined(info.mtime)?.getTime(),
        ].join(":"),
      ),
      Effect.orElseSucceed(() => "none"),
    );
  const bytes = yield* fs.stat(feedback).pipe(
    Effect.map((info) => String(info.size)),
    Effect.orElseSucceed(() => "0"),
  );
  return `${bytes} ${yield* mark(claimsPath(feedback))}`;
});
