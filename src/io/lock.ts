import { DatabaseSync } from "node:sqlite";
import { Effect, Option, Semaphore } from "effect";

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

export const holding = <A, E, R>(lock: string, use: Effect.Effect<A, E, R>) => {
  const once = Effect.acquireUseRelease(
    openLock(lock),
    (db) => (db === undefined ? Effect.succeedNone : Effect.asSome(use)),
    closeLock,
  );
  return queueOf(lock).withPermit(
    Effect.gen(function* () {
      for (let tries = 0; ; tries += 1) {
        const done = yield* once;
        if (Option.isSome(done)) return done.value;
        if (tries >= RETRY.times) return yield* Effect.fail(`${lock} is held`);
        yield* Effect.sleep(RETRY.every);
      }
    }),
  );
};
