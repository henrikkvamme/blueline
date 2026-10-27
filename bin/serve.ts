import { Console, Effect } from "effect";
import { serve as start } from "../src/server/serve.ts";
import { addOrigin, removeOrigin, stopServer, tagFor } from "../src/server/start.ts";
import { deliver } from "./deliver.ts";
import { PLACE } from "./repository.ts";

/*
 * `blueline serve`: starts the machine's server for every app's channel, or says which one
 * runs. It listens until the command or `blueline serve stop` stops it. `blueline add` keeps
 * an origin for a page that loads the overlay by a script tag by hand. The server also runs
 * the wake (bin/deliver.ts): an idle agent gets the reviewer's lines, and with none, a fresh
 * one starts.
 */

/** Where the server runs and keeps its apps (bin/repository.ts). */
export { PLACE };

/** A promise of src/server, with its error as a plain message. */
export const plain = <A>(run: () => Promise<A>) =>
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
  // The wake runs beside the channels, until the server stops (bin/deliver.ts).
  yield* Effect.forkScoped(deliver);
  yield* Effect.promise(() => asked);
  yield* Console.log("Blueline's server stopped.");
});

// Why a command cannot run, as a plain line, and no stack.
export const said =
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
