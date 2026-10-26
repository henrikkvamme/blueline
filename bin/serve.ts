import { Config, Console, Effect, Option } from "effect";
import { serve as start } from "../src/server/serve.ts";
import { addOrigin, placeOf, removeOrigin, stopServer, tagFor } from "../src/server/start.ts";

/*
 * `blueline serve`: starts the machine's server for every app's channel, or says which one
 * runs. It listens until the command or `blueline serve stop` stops it. `blueline add` keeps
 * an origin for a page that loads the overlay by a script tag by hand.
 */

const env = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));

/** Where the server runs and keeps its apps, from the environment (src/server/start.ts). */
const PLACE = Config.all({
  BLUELINE_PORT: env("BLUELINE_PORT"),
  BLUELINE_STATE: env("BLUELINE_STATE"),
  XDG_STATE_HOME: env("XDG_STATE_HOME"),
  HOME: env("HOME"),
}).pipe(Config.map(placeOf));

/** A promise of src/server, with its error as a plain message. */
const plain = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof Error ? error.message : String(error)),
  });

const serveProgram = Effect.gen(function* () {
  const { port, state } = yield* PLACE;
  let ended: () => void = () => undefined;
  const asked = new Promise<void>((done) => (ended = done));
  const served = yield* Effect.acquireRelease(
    plain(() => start({ port, state, stopped: () => ended() })),
    (s) => (s.kind === "started" ? Effect.promise(s.close) : Effect.void),
  );
  if (served.kind === "running") {
    const { version, pid } = served.health;
    return yield* Console.log(
      `Blueline ${version} already serves on port ${String(port)}, as process ${String(pid)}.`,
    );
  }
  yield* Console.log(`Blueline serves every app's channel on http://127.0.0.1:${String(port)}.`);
  yield* Effect.promise(() => asked);
  yield* Console.log("Blueline's server stopped.");
});

// Why a command cannot run, as a plain line, and no stack.
const said =
  (name: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchIf(
        (error): error is E & string => typeof error === "string",
        (message) => Console.error(message).pipe(Effect.andThen(Effect.fail(name))),
      ),
    );

export const serve = serveProgram.pipe(said("serve"));

export const stop = Effect.gen(function* () {
  const place = yield* PLACE;
  const ran = yield* plain(() => stopServer(place));
  yield* Console.log(
    ran ? "Blueline's server stopped." : `No Blueline server runs on port ${String(place.port)}.`,
  );
}).pipe(said("stop"));

export const add = (root: string, origin: string) =>
  Effect.gen(function* () {
    const place = yield* PLACE;
    const app = yield* plain(() => addOrigin(place, root, origin));
    yield* Console.log(
      `${origin} may use ${app.name}'s channel. Put this tag in the page:\n${tagFor(place.port, app)}`,
    );
  }).pipe(said("add"));

export const remove = (root: string, origin: string) =>
  Effect.gen(function* () {
    const place = yield* PLACE;
    const app = yield* plain(() => removeOrigin(place, root, origin));
    yield* Console.log(`${origin} no longer uses ${app.name}'s channel.`);
  }).pipe(said("remove"));
