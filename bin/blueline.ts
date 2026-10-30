#!/usr/bin/env node
/*
 * The `blueline` command: the agent's side of the channel to the dev tools (src/vite.ts),
 * for an agent that runs apart from the dev server. bin/lines.ts reads the command line;
 * each command runs from its own file, and this file only sends it there.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Runtime, Stdio } from "effect";
import { commandOf, helpOf, USAGE } from "./lines.ts";

/*
 * Each command loads its own file only when it runs. A harness runs `blueline hook` at each
 * tool call, so the hook must not wait for the MCP SDK, the server or TypeScript to load.
 */
const load = <A>(module: () => Promise<A>) => Effect.promise(module);

/** `blueline dev`'s exit code after a signal, once its file is loaded. */
let signalExit: () => number | undefined = () => undefined;

/** The exit code of a command line Blueline does not take: the usage, with no error log. */
let usageExit: number | undefined;

const program = Effect.gen(function* () {
  const args = yield* (yield* Stdio.Stdio).args;
  const help = helpOf(args);
  if (help !== undefined) return yield* Console.log(help);
  const command = commandOf(args);
  if (command === undefined) {
    usageExit = 2;
    return yield* Console.error(USAGE);
  }
  switch (command.kind) {
    case "listen": {
      const { listen } = yield* load(() => import("./listen.ts"));
      return yield* Effect.scoped(listen(command.file, command.journey, command.name));
    }
    case "review": {
      const { review } = yield* load(() => import("./listen.ts"));
      return yield* review(command);
    }
    case "reply": {
      const { reply } = yield* load(() => import("./reply.ts"));
      return yield* reply(command);
    }
    case "blocks": {
      const { BLOCKS_GUIDE } = yield* load(() => import("../src/mcp/tools.ts"));
      return yield* Console.log(BLOCKS_GUIDE);
    }
    case "request": {
      const { request } = yield* load(() => import("./request.ts"));
      return yield* request(command);
    }
    case "log": {
      const { log } = yield* load(() => import("./log.ts"));
      return yield* log(command);
    }
    case "serve": {
      const { serve, stop } = yield* load(() => import("./serve.ts"));
      return yield* command.stop ? stop : Effect.scoped(serve);
    }
    case "add": {
      const { add } = yield* load(() => import("./serve.ts"));
      return yield* add(command.root, command.origin);
    }
    case "remove": {
      const { remove } = yield* load(() => import("./serve.ts"));
      return yield* remove(command.root, command.origin);
    }
    case "hook": {
      const { hook } = yield* load(() => import("./hook.ts"));
      return yield* hook(command);
    }
    case "setup": {
      const { setup } = yield* load(() => import("./setup.ts"));
      const { said } = yield* load(() => import("./serve.ts"));
      // Why setup cannot write, as a plain line, and no stack.
      return yield* setup(command).pipe(said("setup"));
    }
    case "wait": {
      const { wait } = yield* load(() => import("./wait.ts"));
      return yield* wait(command);
    }
    case "mcp": {
      const { mcp } = yield* load(() => import("./mcp.ts"));
      return yield* Effect.scoped(mcp(command));
    }
    case "dev": {
      const module = yield* load(() => import("./dev.ts"));
      signalExit = module.signalExit;
      return yield* Effect.scoped(module.dev(command));
    }
    case "apply": {
      const { markedAbove } = yield* load(() => import("./agents.ts"));
      const { applyCommand } = yield* load(() => import("./apply-run.ts"));
      // What the agent must decide, as a plain line, and no stack.
      yield* markedAbove(command.file);
      return yield* applyCommand(command).pipe(
        Effect.flatMap((said) => Console.log(said.join("\n"))),
        Effect.catchIf(
          (error) => typeof error === "string",
          (message) => Console.error(message).pipe(Effect.andThen(Effect.fail("apply"))),
        ),
      );
    }
  }
});

program.pipe(
  Effect.provide(NodeServices.layer),
  // `blueline dev` stopped by a signal exits as its command does: 128 plus its number.
  NodeRuntime.runMain({
    teardown: (exit, onExit) => {
      const code = signalExit() ?? usageExit;
      if (code === undefined) Runtime.defaultTeardown(exit, onExit);
      else onExit(code);
    },
  }),
);
