import { Clock, Effect, FileSystem, Path, PlatformError, Random, Schedule, Schema } from "effect";
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

/** The file in a lock that names its owner: the process and a token of its own. */
const OWNER = "owner";

/** A lock with no owner file: a process died between making and naming it. */
const UNNAMED_MS = 10_000;

/** Whether the process runs. EPERM: it runs, as another user's. */
function runs(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

const isMissing = (error: PlatformError.PlatformError) => error.reason._tag === "NotFound";

/**
 * Takes a lock folder in one step: a folder of its own with the owner file is renamed to the
 * lock's name, which fails while another lock with its owner file is there. So a lock always
 * names its owner. Fails when the lock is held.
 */
const takeLock = Effect.fn(function* (lock: string, token: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const own = `${lock}.${(yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)).toString(36)}`;
  yield* fs.makeDirectory(own);
  yield* fs.writeFileString(path.join(own, OWNER), token);
  const took = yield* fs.rename(own, lock).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
  if (took) return;
  yield* fs.remove(own, { recursive: true }).pipe(Effect.ignore);
  return yield* Effect.fail(`${lock} is held`);
});

/** The lock's owner token, if it has one. */
const ownerOf = (lock: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFileString(path.join(lock, OWNER)).pipe(Effect.option);
  });

/** Gives up the lock if `token` still owns it: moved aside in one step, then removed, so no
 * one takes the lock's name while it is half removed. */
const dropLock = Effect.fn(function* (lock: string, token: string | undefined) {
  const fs = yield* FileSystem.FileSystem;
  if (token !== undefined) {
    const owner = yield* ownerOf(lock);
    if (owner._tag === "None" || owner.value !== token) return;
  }
  const aside = `${lock}.gone.${(yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)).toString(36)}`;
  if (
    yield* fs.rename(lock, aside).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
  )
    yield* fs.remove(aside, { recursive: true }).pipe(Effect.ignore);
});

/** Whether the lock's owner is dead: its process no longer runs, or it has no owner file
 * long after it was made. */
const deadOwner = Effect.fn(function* (lock: string) {
  const fs = yield* FileSystem.FileSystem;
  const owner = yield* ownerOf(lock);
  if (owner._tag === "Some") {
    const pid = Number(owner.value.split(" ")[0]);
    return Number.isInteger(pid) && pid > 0 && !runs(pid) ? owner.value : undefined;
  }
  const info = yield* fs.stat(lock).pipe(Effect.option);
  if (info._tag === "None" || info.value.mtime._tag === "None") return undefined;
  const age = (yield* Clock.currentTimeMillis) - info.value.mtime.value.getTime();
  return age > UNNAMED_MS ? "" : undefined;
});

/**
 * Removes the lock of a dead process. Under a second lock, `.break`, it checks again that the
 * same dead owner holds it, so two processes never both break one lock and remove a live
 * one. A dead process's `.break` goes the same way, without a third lock: it is held for a
 * moment only.
 */
const breakDead = Effect.fn(function* (lock: string, token: string) {
  const seen = yield* deadOwner(lock);
  if (seen === undefined) return;
  const guard = `${lock}.break`;
  const took = yield* takeLock(guard, token).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
  if (!took) {
    if ((yield* deadOwner(guard)) !== undefined) yield* dropLock(guard, undefined);
    return;
  }
  yield* Effect.gen(function* () {
    const still = yield* deadOwner(lock);
    if (still !== undefined && still === seen) yield* dropLock(lock, undefined);
  }).pipe(Effect.ensuring(dropLock(guard, token).pipe(Effect.ignore)));
});

/**
 * Runs `use` while this process holds the file's lock, a folder beside it that names its
 * owner. A lock goes only when its owner's process is dead (`breakDead`), so a slow
 * operation keeps its lock, and it gives up only its own lock.
 */
export const withLock = <A, E, R>(file: string, use: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const lock = `${file}.lock`;
    // The folder the file goes in, as `.blueline/` before the first note.
    yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
    const token = `${String(process.pid)} ${(yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)).toString(36)}`;
    const take = takeLock(lock, token).pipe(
      Effect.tapError(() => breakDead(lock, token).pipe(Effect.ignore)),
    );
    // About 10 s, then it fails and says so: a live owner holds it that long only if stuck.
    yield* take.pipe(Effect.retry({ schedule: Schedule.spaced("25 millis"), times: 400 }));
    return yield* use.pipe(Effect.ensuring(dropLock(lock, token).pipe(Effect.ignore)));
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
