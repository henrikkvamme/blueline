#!/usr/bin/env node
/*
 * The `blueline` command: the agent's side of the channel to the dev tools (src/vite.ts),
 * for an agent that runs apart from the dev server. bin/lines.ts reads the command line;
 * each command runs from its own file, and this file only sends it there.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio } from "effect";
import { applyCommand } from "./apply-run.ts";
import { commandOf, USAGE } from "./lines.ts";
import { listen, review } from "./listen.ts";
import { reply } from "./reply.ts";
import { serve } from "./serve.ts";

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
      return yield* Effect.scoped(serve);
    case "apply":
      // What the agent must decide, as a plain line, and no stack.
      return yield* applyCommand(command).pipe(
        Effect.catchIf(
          (error) => typeof error === "string",
          (message) => Console.error(message).pipe(Effect.andThen(Effect.fail("apply"))),
        ),
      );
  }
});

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
