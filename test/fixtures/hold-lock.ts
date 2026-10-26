/*
 * A process that takes the lock on a file a few times, and writes to a log when it goes in
 * and out, for test/wire.test.ts: the log shows whether two processes held the lock at once.
 */
import { appendFileSync } from "node:fs";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { withLock } from "../../bin/wire.ts";

const [file = "", log = ""] = process.argv.slice(2);
const mark = (sign: string) =>
  Effect.sync(() => appendFileSync(log, `${sign}${String(process.pid)}\n`));

const held = mark("+").pipe(Effect.andThen(Effect.sleep("3 millis")), Effect.andThen(mark("-")));

Effect.forEach(Array.from({ length: 5 }), () => withLock(file, held)).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
