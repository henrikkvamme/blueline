/*
 * A process that takes the lock on a file, for test/wire.test.ts. With a log, it takes the
 * lock a few times and writes when it goes in and out, so the log shows whether two
 * processes held it at once. With `hold`, it takes the lock, says `held` and keeps it.
 */
import { appendFileSync } from "node:fs";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { withLock } from "../../bin/wire.ts";

const [file = "", log = "hold"] = process.argv.slice(2);
const mark = (sign: string) =>
  Effect.sync(() => appendFileSync(log, `${sign}${String(process.pid)}\n`));

const held = mark("+").pipe(Effect.andThen(Effect.sleep("3 millis")), Effect.andThen(mark("-")));

const program =
  log === "hold"
    ? withLock(file, Console.log("held").pipe(Effect.andThen(Effect.never)))
    : Effect.forEach(Array.from({ length: 5 }), () => withLock(file, held));

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
