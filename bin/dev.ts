import { constants } from "node:os";
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

/** The first signal that stopped `blueline dev`, for its exit code. */
let stoppedBy: NodeJS.Signals | undefined;

/** The exit code a signal gives, as a shell gives it: 128 plus its number. */
export const signalExit = () =>
  stoppedBy === undefined ? undefined : 128 + (constants.signals[stoppedBy] ?? 0);

/**
 * Keeps the signal that stops `blueline dev`; the runtime stops the program on SIGINT and
 * SIGTERM. A terminal that closes (SIGHUP) stops it in the same way, and its command with it.
 */
const onSignals = Effect.acquireRelease(
  Effect.sync(() => {
    const kept = (signal: NodeJS.Signals) => {
      stoppedBy ??= signal;
      if (signal === "SIGHUP") process.kill(process.pid, "SIGTERM");
    };
    for (const signal of SIGNALS) process.on(signal, kept);
    return kept;
  }),
  (kept) =>
    Effect.sync(() => {
      for (const signal of SIGNALS) process.off(signal, kept);
    }),
);
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export const dev = (command: Extract<Command, { kind: "dev" }>) =>
  Effect.gen(function* () {
    const place = yield* PLACE;
    yield* onSignals;
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
