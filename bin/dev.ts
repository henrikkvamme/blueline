import { Console, Effect, Runtime } from "effect";
import { startDev } from "../src/server/dev.ts";
import type { Command } from "./lines.ts";
import { PLACE, plain, said } from "./serve.ts";

/*
 * `blueline dev -- <cmd>`: runs the app's dev command behind a proxy on the page's port,
 * with the overlay on each page (src/server/dev.ts). It runs until the command ends, or a
 * signal stops it; then the command's whole process group stops too. It exits with the
 * command's own code.
 */

/** The command's end, with its exit code and nothing more to say. */
class Ended {
  readonly [Runtime.errorReported] = false;
  readonly [Runtime.errorExitCode]: number;
  constructor(code: number) {
    this[Runtime.errorExitCode] = code;
  }
}

/** A terminal that closes stops `blueline dev` as Ctrl+C does, and its command with it. */
const onHangUp = Effect.acquireRelease(
  Effect.sync(() => {
    const hangUp = () => void process.kill(process.pid, "SIGTERM");
    process.once("SIGHUP", hangUp);
    return hangUp;
  }),
  (hangUp) => Effect.sync(() => void process.off("SIGHUP", hangUp)),
);

export const dev = (command: Extract<Command, { kind: "dev" }>) =>
  Effect.gen(function* () {
    const place = yield* PLACE;
    yield* onHangUp;
    const running = yield* Effect.acquireRelease(
      plain(() =>
        startDev({
          root: ".",
          command: command.command,
          port: command.port,
          host: command.host,
          place,
          say: (line) => console.error(`[blueline] ${line}`),
        }),
      ),
      (d) => Effect.promise(d.stop),
    );
    yield* Console.error(`[blueline] The page with Blueline is on ${running.url}.`);
    const code = yield* Effect.promise(() => running.ended);
    if (code !== 0) return yield* Effect.fail(new Ended(code));
  }).pipe(said("dev"));
