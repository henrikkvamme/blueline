import {
  McpServer,
  type CallToolResult,
  type JSONRPCMessage,
  type RequestId,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Cause, Clock, Console, Effect, Exit, FileSystem, Path, Schema } from "effect";
import pkg from "../package.json" with { type: "json" };
import { APPLY, INSTRUCTIONS, NOTHING_NEW, REPLY, WAIT_FOR_FEEDBACK } from "../src/mcp/tools.ts";
import { BlockSchema } from "../src/notes/blocks.ts";
import { applyCommand } from "./apply-run.ts";
import type { Command, Line } from "./lines.ts";
import { listenerPick, tagged } from "./listen.ts";
import { answer } from "./reply.ts";
import { markedAbove } from "./agents.ts";
import { changeOf, claim, unclaim } from "./wire.ts";

/*
 * `blueline mcp`: an MCP server on stdio for one agent, with the tools in src/mcp/tools.ts
 * (ADR 0005). `wait_for_feedback` claims the agent's lines as `listen` does, under the
 * feedback file's lock (bin/wire.ts), so a line it gives the agent never comes again by a
 * wake or a hook, and a line a wake took never comes here. `reply` and `apply` do what the
 * commands do.
 *
 * The SDK sends no result for a call whose client cancelled it or went away, so a wait that
 * claimed lines then would lose them. A wait keeps the lines it claimed as its receipt, and
 * the transport marks the call delivered when it sends its result. A wait that ends with its
 * signal aborted and nothing delivered gives its receipt back (`unclaim`).
 */

type McpCommand = Extract<Command, { kind: "mcp" }>;
type Services = FileSystem.FileSystem | Path.Path;
export type Run = <A, E>(
  effect: Effect.Effect<A, E, Services>,
  options?: { readonly signal?: AbortSignal },
) => Promise<Exit.Exit<A, E>>;

/** Whether the transport sent a call's result. */
export interface Delivery {
  sent: boolean;
}

/** The stdio transport, which marks each watched call delivered when it sends its result,
 * and says when it has closed. */
class Wire extends StdioServerTransport {
  readonly watched = new Map<RequestId, Delivery>();
  private ended: () => void = () => {};
  readonly closed = new Promise<void>((done) => (this.ended = done));

  override async send(message: JSONRPCMessage) {
    // In the same step as the SDK's check of the signal: nothing comes between them.
    if (
      "id" in message &&
      message.id !== undefined &&
      ("result" in message || "error" in message)
    ) {
      const delivery = this.watched.get(message.id);
      if (delivery !== undefined) delivery.sent = true;
      this.watched.delete(message.id);
    }
    return super.send(message);
  }

  override async close() {
    await super.close();
    this.ended();
  }
}

const text = (words: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: words }],
  ...(isError ? { isError } : {}),
});

/** A tool's input: its JSON Schema as fixed words, checked with an Effect schema. */
function input<S extends Schema.Top & Schema.ConstraintDecoder<unknown>>(
  schema: S,
  json: object,
): StandardSchemaWithJSON<S["Encoded"], S["Type"]> {
  const standard = Schema.toStandardSchemaV1(schema)["~standard"];
  return {
    "~standard": {
      ...standard,
      jsonSchema: { input: () => ({ ...json }), output: () => ({ ...json }) },
    },
  };
}

const ReplyInput = Schema.Struct({
  id: Schema.String,
  state: Schema.Literals(["working", "replied", "settled"]),
  text: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  blocks: Schema.optional(Schema.Array(BlockSchema)),
});
const ApplyInput = Schema.Struct({ part: Schema.String, keep: Schema.optional(Schema.String) });
const NoInput = Schema.Struct({});

/** What is wrong with a reply, or nothing. */
function wrongIn(reply: typeof ReplyInput.Type): string | undefined {
  const words = reply.text !== undefined && reply.text.trim() !== "";
  if (reply.state === "replied" && !words) return "A replied answer needs its text.";
  if (reply.state !== "replied" && (words || reply.variant !== undefined))
    return `A ${reply.state} answer has no text or variant: reply with state replied for your words.`;
  if (reply.state === "settled" && reply.blocks !== undefined)
    return "A settled answer has no blocks.";
  return undefined;
}

/** The wait's options, and what it shares with the server. */
export interface Waiting {
  readonly run: Run;
  readonly feedback: string;
  readonly journey: string | undefined;
  readonly name: string;
  readonly waitMs: number;
  /** Whether no wait has claimed yet: the first lines are from before the agent listened. */
  readonly reader: { first: boolean };
  readonly watched: Map<RequestId, Delivery>;
  /** The give-backs that run: the process ends after them. */
  readonly givingBack: Set<Promise<unknown>>;
}

/** One wait: it claims at once, then each second when the files changed, until it takes a
 * line that needs the agent, or its time is up. An aborted signal claims nothing. */
const pull = Effect.fn(function* (
  waiting: Waiting,
  signal: AbortSignal,
  receipt: (taken: readonly Line[]) => void,
) {
  const until = (yield* Clock.currentTimeMillis) + waiting.waitMs;
  let seen = "";
  for (;;) {
    const change = yield* changeOf(waiting.feedback);
    if (change !== seen) {
      const first = waiting.reader.first;
      const taken = yield* claim(
        waiting.feedback,
        waiting.name,
        (fresh) =>
          signal.aborted ? { take: [], through: undefined } : listenerPick(fresh, waiting.journey),
        receipt,
      );
      waiting.reader.first = false;
      seen = change;
      if (taken.length > 0) return tagged(taken, yield* Clock.currentTimeMillis, first);
    }
    const now = yield* Clock.currentTimeMillis;
    if (now >= until) return [];
    yield* Effect.sleep(Math.min(1000, until - now));
  }
});

/** The `wait_for_feedback` handler. */
export const waitHandler =
  (waiting: Waiting) =>
  async (request: { readonly signal: AbortSignal; readonly id: RequestId }) => {
    const { signal, id } = request;
    const delivery: Delivery = { sent: false };
    waiting.watched.set(id, delivery);
    let receipt: readonly Line[] = [];
    // The session waits while the call runs, so no wake starts another agent beside it.
    const done = waiting.run(
      markedAbove(waiting.feedback, "waiting").pipe(
        Effect.andThen(pull(waiting, signal, (taken) => (receipt = taken))),
        Effect.ensuring(markedAbove(waiting.feedback, "busy")),
      ),
      { signal },
    );
    signal.addEventListener(
      "abort",
      () => {
        const back = done.then(async () => {
          waiting.watched.delete(id);
          if (delivery.sent || receipt.length === 0) return;
          const given = await waiting.run(
            unclaim(
              waiting.feedback,
              waiting.name,
              receipt.map((l) => l.id),
            ),
          );
          if (Exit.isFailure(given))
            await waiting.run(
              Console.error(`[mcp] could not give lines back: ${Cause.pretty(given.cause)}`),
            );
        });
        waiting.givingBack.add(back);
        void back.finally(() => waiting.givingBack.delete(back));
      },
      { once: true },
    );
    const exit = await done;
    if (Exit.isFailure(exit))
      return text(`Could not read the review's lines: ${Cause.pretty(exit.cause)}`, true);
    return text(exit.value.length === 0 ? NOTHING_NEW : exit.value.join("\n"));
  };

/** The server for one agent, with its tools in their order. */
function serverFor(command: McpCommand, waiting: Waiting, status: string) {
  const server = new McpServer(
    { name: "blueline", version: pkg.version },
    { capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS },
  );
  const wait = waitHandler(waiting);
  server.registerTool(
    WAIT_FOR_FEEDBACK.name,
    {
      description: WAIT_FOR_FEEDBACK.description,
      inputSchema: input(NoInput, WAIT_FOR_FEEDBACK.inputSchema),
    },
    (_, ctx) => wait({ signal: ctx.mcpReq.signal, id: ctx.mcpReq.id }),
  );
  server.registerTool(
    REPLY.name,
    { description: REPLY.description, inputSchema: input(ReplyInput, REPLY.inputSchema) },
    async (reply) => {
      const wrong = wrongIn(reply);
      if (wrong !== undefined) return text(wrong, true);
      await waiting.run(markedAbove(waiting.feedback));
      const exit = await waiting.run(
        answer(
          {
            kind: "reply",
            file: status,
            id: reply.id,
            state: reply.state,
            text: reply.text ?? "",
            variant: reply.variant,
            blocks: undefined,
          },
          reply.blocks,
        ),
      );
      if (Exit.isFailure(exit))
        return text(`Could not write the answer: ${Cause.pretty(exit.cause)}`, true);
      return text(`${reply.state} on ${reply.id}.`);
    },
  );
  server.registerTool(
    APPLY.name,
    { description: APPLY.description, inputSchema: input(ApplyInput, APPLY.inputSchema) },
    async ({ part, keep }) => {
      const exit = await waiting.run(
        applyCommand({ kind: "apply", file: command.file, part, keep, src: command.src }),
      );
      if (Exit.isSuccess(exit)) return text(exit.value.join("\n"));
      // What the agent must decide, in its own words.
      const failure = Cause.findErrorOption(exit.cause);
      if (failure._tag === "Some" && typeof failure.value === "string")
        return text(failure.value, true);
      return text(`Could not apply: ${Cause.pretty(exit.cause)}`, true);
    },
  );
  return server;
}

/** Serves the agent until its client goes away or a signal stops it, and then ends after
 * the lines of a cancelled wait are back. */
export const mcp = Effect.fn(function* (command: McpCommand) {
  const path = yield* Path.Path;
  const run: Run = Effect.runPromiseExitWith(yield* Effect.context<Services>());
  const wire = new Wire();
  const waiting: Waiting = {
    run,
    feedback: command.file,
    journey: command.journey,
    name: command.name,
    waitMs: command.waitMs,
    reader: { first: true },
    watched: wire.watched,
    givingBack: new Set(),
  };
  const status = command.status ?? path.join(path.dirname(command.file), "status.json");
  const handle = serveStdio(() => serverFor(command, waiting, status), {
    transport: wire,
    onerror: (error) => void run(Console.error(`[mcp] ${error.message}`)),
  });
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      await handle.close();
      // A give-back can start a give-back of none: wait until no more run.
      while (waiting.givingBack.size > 0) await Promise.allSettled(waiting.givingBack);
    }),
  );
  yield* Effect.promise(() => wire.closed);
});
