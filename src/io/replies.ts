import { Schema } from "effect";
// The agent's side runs this file in Node, which needs the extension.
import { BlockSchema } from "../notes/blocks.ts";

/*
 * The agent's answers, by note ID, as the status file has them: the page reads them
 * (channel.ts), and the agent's side writes them (bin/reply.ts).
 */

export const ReplySchema = Schema.Struct({
  state: Schema.Literals(["working", "replied"]),
  /** When the agent last said it works on the note, in ms: a working state from before the
   * reviewer's newest message is no answer to it. A file from before 0.1.14 has none. */
  workingAt: Schema.optional(Schema.Finite),
  /** The agent settles a note only after the reviewer said it is right. */
  settled: Schema.optional(Schema.Boolean),
  /** When the agent settled it, in ms: a message the reviewer wrote after it opens the note
   * again, and the settle no longer counts. */
  settledAt: Schema.optional(Schema.Finite),
  /** What the agent shows while it works, as a plan: each working reply puts its own in place
   * of the last, and the reply ends it. */
  progress: Schema.optional(Schema.Array(BlockSchema)),
  replies: Schema.optional(
    Schema.Array(
      Schema.Struct({
        text: Schema.String,
        /** When the agent wrote it, in ms, so the page draws it by time among the reviewer's
         * messages. A status file from before 0.1.8 has none, until the listener, the MCP
         * server or a reply gives it 0 (bin/lines.ts, `dated`): it then goes above every chat. */
        at: Schema.optional(Schema.Finite),
        variant: Schema.optional(Schema.String),
        /** What the reply shows besides its words: a question, variants, a table (blocks.ts). */
        blocks: Schema.optional(Schema.Array(BlockSchema)),
      }),
    ),
  ),
});
export type Reply = typeof ReplySchema.Type;

export const RepliesSchema = Schema.Record(Schema.String, ReplySchema);
export type Replies = typeof RepliesSchema.Type;
