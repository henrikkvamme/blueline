#!/usr/bin/env node
/*
 * The `blueline` command: the agent's side of the channel to the dev tools (src/vite.ts),
 * for an agent that runs apart from the dev server. bin/lines.ts reads the command line;
 * each command runs from its own file, and this file only sends it there.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Runtime, Stdio } from "effect";
import { markedAbove } from "./agents.ts";
import { applyCommand } from "./apply-run.ts";
import { dev, signalExit } from "./dev.ts";
import { hook } from "./hook.ts";
import { commandOf, USAGE } from "./lines.ts";
import { listen, review } from "./listen.ts";
import { mcp } from "./mcp.ts";
import { setup } from "./setup.ts";
import { wait } from "./wait.ts";
import { reply } from "./reply.ts";
import { add, remove, serve, stop } from "./serve.ts";

const program = Effect.gen(function* () {
  const command = commandOf(yield* (yield* Stdio.Stdio).args);
  if (command === undefined) {
    yield* Console.error(USAGE);
    return yield* Effect.fail("usage");
  }
  switch (command.kind) {
    case "listen":
      return yield* Effect.scoped(listen(command.file, command.journey, command.name));
    case "review":
      return yield* review(command);
    case "reply":
      return yield* reply(command);
    case "serve":
      return yield* command.stop ? stop : Effect.scoped(serve);
    case "add":
      return yield* add(command.root, command.origin);
    case "remove":
      return yield* remove(command.root, command.origin);
    case "hook":
      return yield* hook(command);
    case "setup":
      return yield* setup(command);
    case "wait":
      return yield* wait(command);
    case "mcp":
      return yield* Effect.scoped(mcp(command));
    case "dev":
      return yield* Effect.scoped(dev(command));
    case "apply":
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
});

program.pipe(
  Effect.provide(NodeServices.layer),
  // `blueline dev` stopped by a signal exits as its command does: 128 plus its number.
  NodeRuntime.runMain({
    teardown: (exit, onExit) => {
      const code = signalExit();
      if (code === undefined) Runtime.defaultTeardown(exit, onExit);
      else onExit(code);
    },
  }),
);
