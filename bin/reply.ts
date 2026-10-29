import { Clock, Console, Effect, FileSystem, Schema } from "effect";
import { ReplySchema } from "../src/io/replies.ts";
import { BlockSchema, type Block } from "../src/notes/blocks.ts";
import { markedAbove } from "./agents.ts";
import { dated, replyAfter, type Command } from "./lines.ts";
import { feedbackOf, repositoryOf } from "./repository.ts";
import { readFile, withLock, writeWhole } from "./wire.ts";

/*
 * `reply` answers a note in the status file. It reads and writes the file under the file's
 * lock (bin/wire.ts), so two replies at once both stay, and writes it whole, so the page
 * never reads half of it. `--blocks` adds what the reply shows besides its words, from a
 * JSON file with a list of blocks (src/notes/blocks.ts); one that does not read fails, and
 * says where. On `working`, the blocks are the agent's progress, as a plan: each working
 * reply puts its own in place of the last, and the next reply ends it. `blueline mcp`'s
 * `reply` tool writes with `answer`, with the blocks from its input.
 */

/** The answers by note ID. One that is not an answer is kept as it is. */
const StatusFile = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Union([ReplySchema, Schema.Json])),
  { space: 1 },
);
const isReply = Schema.is(ReplySchema);
const BlocksFile = Schema.fromJsonString(Schema.Array(BlockSchema));

export const reply = Effect.fn(function* (command: Extract<Command, { kind: "reply" }>) {
  // A reply joins the agent's session to the review, in each of the repository's apps.
  const repository = yield* repositoryOf(".").pipe(Effect.orElseSucceed(() => undefined));
  const files = repository === undefined ? [] : yield* feedbackOf(repository);
  yield* Effect.forEach(files, (feedback) => markedAbove(feedback), { discard: true });
  const blocks =
    command.blocks === undefined
      ? undefined
      : yield* (yield* FileSystem.FileSystem).readFileString(command.blocks).pipe(
          Effect.flatMap(Schema.decodeEffect(BlocksFile)),
          Effect.tapError((error) => Console.error(`The blocks do not read: ${String(error)}`)),
        );
  yield* answer(command, blocks);
});

/**
 * Gives each reply in the status file a time, under its lock: one that a Blueline before
 * 0.1.8 wrote has none, and came before this run (bin/lines.ts, `dated`). The listener and
 * the MCP server do it as they start, so an old reply on a note never reads as an answer to
 * the note's next chat. A status file that is not there yet has nothing to date.
 */
export const dateReplies = Effect.fn(function* (file: string) {
  if (!(yield* (yield* FileSystem.FileSystem).exists(file))) return;
  yield* withLock(
    file,
    Effect.gen(function* () {
      const all = yield* readFile(file, StatusFile, {});
      const next = Object.fromEntries(
        Object.entries(all).map(([id, value]) => [id, isReply(value) ? dated(value) : value]),
      );
      if (Object.entries(next).every(([id, value]) => value === all[id])) return;
      yield* writeWhole(file, `${yield* Schema.encodeEffect(StatusFile)(next)}\n`);
    }),
  );
});

/** Writes the answer to a note in the status file, under its lock. */
export const answer = Effect.fn(function* (
  command: Extract<Command, { kind: "reply" }>,
  blocks: readonly Block[] | undefined,
) {
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
