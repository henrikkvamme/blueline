import { Effect } from "effect";
import type { DevResult } from "../types";

/*
 * An app's code for a step can give its result as a value, a Promise or an Effect
 * (types.ts `DevResult`). The session runs each as an Effect. The code gets an AbortSignal
 * that aborts when the session stops waiting for it: the walk went on to another step, or
 * the tools stopped. A Promise cannot be stopped, so its result then comes too late and the
 * session drops it. A failure is a defect: the actors log it, and the walk goes on.
 */

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

/** Runs the app's code as an Effect, with a signal that aborts when it is interrupted. */
export const fromResult = <A>(code: (signal: AbortSignal) => DevResult<A>): Effect.Effect<A> =>
  Effect.suspend(() => {
    const controller = new AbortController();
    const result = code(controller.signal);
    const run: Effect.Effect<A> = Effect.isEffect(result)
      ? result
      : isThenable(result)
        ? Effect.callback<A>((resume) => {
            result.then(
              (value) => resume(Effect.succeed(value)),
              (error: unknown) => resume(Effect.die(error)),
            );
          })
        : Effect.succeed(result);
    return run.pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())));
  });
