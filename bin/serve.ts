import { Config, Console, Effect } from "effect";
import { PORT, serve as start } from "../src/server/serve.ts";

/*
 * `blueline serve`: starts the machine's server for every app's channel, or says which one
 * runs. It listens until the command stops, then closes the server.
 */

/** Where the server keeps its apps: Blueline's folder in the user's state folder. */
const STATE = Config.String("BLUELINE_STATE").pipe(
  Config.orElse(() =>
    Config.String("XDG_STATE_HOME").pipe(
      Config.orElse(() => Config.String("HOME").pipe(Config.map((home) => `${home}/.local/state`))),
      Config.map((folder) => `${folder}/blueline`),
    ),
  ),
);

const program = Effect.gen(function* () {
  const port = yield* Config.Port("BLUELINE_PORT").pipe(Config.withDefault(PORT));
  const state = yield* STATE;
  const served = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => start({ port, state }),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    }),
    (s) => (s.kind === "started" ? Effect.promise(s.close) : Effect.void),
  );
  if (served.kind === "running") {
    const { version, pid } = served.health;
    return yield* Console.log(
      `Blueline ${version} already serves on port ${String(port)}, as process ${String(pid)}.`,
    );
  }
  yield* Console.log(`Blueline serves every app's channel on http://127.0.0.1:${String(port)}.`);
  return yield* Effect.never;
});

// Why the server cannot start, as a plain line, and no stack.
export const serve = program.pipe(
  Effect.catchIf(
    (error) => typeof error === "string",
    (message) => Console.error(message).pipe(Effect.andThen(Effect.fail("serve"))),
  ),
);
