import { Clock, Console, Effect, FileSystem, Schema } from "effect";
import { ReplySchema } from "../src/io/replies.ts";
import { BlockSchema } from "../src/notes/blocks.ts";
import { replyAfter, type Command } from "./lines.ts";
import { readFile, withLock, writeWhole } from "./wire.ts";

/*
 * `reply` answers a note in the status file. It reads and writes the file under the file's
 * lock (bin/wire.ts), so two replies at once both stay, and writes it whole, so the page
 * never reads half of it. `--blocks` adds what the reply shows besides its words, from a
 * JSON file with a list of blocks (src/notes/blocks.ts); one that does not read fails, and
 * says where. On `working`, the blocks are the agent's progress, as a plan: each working
 * reply puts its own in place of the last, and the next reply ends it.
 */

/** The answers by note ID. One that is not an answer is kept as it is. */
const StatusFile = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Union([ReplySchema, Schema.Json])),
  { space: 1 },
);
const isReply = Schema.is(ReplySchema);
const BlocksFile = Schema.fromJsonString(Schema.Array(BlockSchema));

export const reply = Effect.fn(function* (command: Extract<Command, { kind: "reply" }>) {
  const blocks =
    command.blocks === undefined
      ? undefined
      : yield* (yield* FileSystem.FileSystem).readFileString(command.blocks).pipe(
          Effect.flatMap(Schema.decodeEffect(BlocksFile)),
          Effect.tapError((error) => Console.error(`The blocks do not read: ${String(error)}`)),
        );
  yield* withLock(
    command.file,
    Effect.gen(function* () {
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
    }),
  );
});
