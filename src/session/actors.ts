import { Clock, DateTime, Effect, Fiber, Schedule } from "effect";
import { fromCallback } from "xstate";
import { registry } from "../core/registry";
import { fromResult } from "../core/result";
import { postLine, readListening, readReplies } from "../io/channel";
import { listenedJourneys } from "../io/listening";
import { ROUTES } from "../io/routes";
import { PAGE_JOURNEY, pageJourney, pageParts } from "../part/page";
import { parts } from "../part/store";
import type { DevAdapter, DevShift, DevStep, JourneyInfo } from "../types";
import { postedLine } from "./lines";
import {
  sessionMachine,
  type EnterInput,
  type Event,
  type KeepInput,
  type Post,
  type SwitchInput,
} from "./machine";
import type { Entered, Shape } from "./state";

/*
 * The machine's actors for a real page: each runs an Effect, and the machine stops it by
 * leaving the state that runs it. The app's code for a step runs through `fromResult`
 * (core/result.ts), so its signal aborts then. A step's `reset` always finishes, so no half
 * state stays.
 */

/** How long the shift card shows at least, so the reviewer can read it. */
const SHIFT_MS = 1300;

/** Runs an Effect for an actor, and stops it when the actor stops. */
const run = (effect: Effect.Effect<void>) => {
  const fiber = Effect.runFork(effect);
  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
};

/** A step's code failed: the walk goes on, and the console says why. */
const quietly = <A>(what: string, effect: Effect.Effect<A>) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchCause((cause) => Effect.logError(`The dev tools could not ${what}`, cause)),
  );

/** A post and the posts sent after it, in their order. */
const chainOf = (post: Post | undefined): readonly Post[] =>
  post === undefined ? [] : [post, ...chainOf(post.next)];

/** Waits for the page to name a choice, as a page names its choices once it shows. */
const choiceNamed = (name: string) =>
  Effect.sync(() => registry.choice(name)).pipe(
    Effect.repeat({
      until: (choice) => choice !== undefined,
      schedule: Schedule.spaced("50 millis"),
      times: 60,
    }),
  );

/** The journeys as the machine needs them. */
export const shapesOf = (journeys: readonly JourneyInfo[]): readonly Shape[] =>
  journeys.map((j) => ({
    id: j.id,
    title: j.title,
    steps: j.steps.map((s) => ({
      id: s.id,
      group: s.group.id,
      variants: (s.variants ?? []).map((v) => v.label),
    })),
  }));

export interface Live<C> {
  readonly adapter: DevAdapter<C>;
  /** Shows what changes while a step's world changes, or nothing. */
  readonly shift: (shift: DevShift | undefined) => void;
  /** The page's path, which the page's own review names. */
  readonly path?: () => string;
}

/** The session machine, wired to the app's adapter and the page. */
export function liveMachine<C>(live: Live<C>) {
  const { adapter } = live;
  const routes = adapter.channel ?? ROUTES;
  // The app's journeys, and the review of the parts on the page now.
  const journeys = () => [
    ...adapter.journeys,
    pageJourney<C>(pageParts(parts.current().instances), live.path?.()),
  ];
  const stepAt = (journey: string, at: number): DevStep<C> | undefined =>
    (journeys().find((j) => j.id === journey) ?? journeys()[0])?.steps[at];

  /** Takes every variant's state off, then shows this one. */
  const showVariant = (step: DevStep<C>, index: number, context: C) =>
    Effect.gen(function* () {
      const { reset } = step;
      if (reset !== undefined)
        yield* Effect.uninterruptible(fromResult((signal) => reset(context, signal)));
      const variant = step.variants?.[index];
      if (variant?.choice !== undefined) {
        const [name, option] = variant.choice;
        const choice = yield* choiceNamed(name);
        choice?.choose(option);
      }
      const apply = variant?.apply;
      if (apply !== undefined) yield* fromResult((signal) => apply(context, signal));
    });

  const leave = (leaving: Entered | undefined) => {
    const step = leaving === undefined ? undefined : stepAt(leaving.journey, leaving.at);
    const reset = step?.reset;
    return reset === undefined
      ? Effect.void
      : quietly(
          "reset the step before",
          Effect.uninterruptible(fromResult((signal) => reset(adapter.context(), signal))),
        );
  };

  const enter = (input: EnterInput) =>
    Effect.gen(function* () {
      const step = stepAt(input.journey, input.at);
      if (step === undefined) return;
      // A settled step shows the variants its settle kept, as the page draws it.
      yield* Effect.sync(() => {
        for (const [part, variant] of Object.entries(input.kept))
          parts.show(part, { variant, state: parts.shown(part).state });
      });
      yield* leave(input.leaving);
      const started = yield* Clock.currentTimeMillis;
      let shown = false;
      // A step of the page's review is on the page already.
      const context =
        input.journey === PAGE_JOURNEY
          ? adapter.context()
          : yield* fromResult((signal) =>
              adapter.enter(step, {
                fresh: input.fresh,
                // A step the walk left shows nothing more over the next one.
                show: (shift) => {
                  if (signal.aborted) return;
                  shown ||= shift !== undefined;
                  live.shift(shift);
                },
                signal,
              }),
            );
      const { setup } = step;
      if (setup !== undefined)
        yield* quietly(
          "open the step's part",
          fromResult((signal) => setup(context, signal)),
        );
      yield* quietly("show the variant", showVariant(step, input.variant, context));
      if (shown) {
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(Math.max(0, SHIFT_MS - (now - started)));
      }
    }).pipe(Effect.ensuring(Effect.sync(() => live.shift(undefined))), (walk) =>
      quietly("open the step", walk),
    );

  return sessionMachine.provide({
    actors: {
      enterStep: fromCallback<Event, EnterInput>(({ input, sendBack }) =>
        run(enter(input).pipe(Effect.andThen(Effect.sync(() => sendBack({ type: "entered" }))))),
      ),
      switchVariant: fromCallback<Event, SwitchInput>(({ input, sendBack }) =>
        run(
          Effect.gen(function* () {
            const step = stepAt(input.journey, input.at);
            if (step !== undefined)
              yield* quietly(
                "show the variant",
                showVariant(step, input.variant, adapter.context()),
              );
            sendBack({ type: "switched" });
          }),
        ),
      ),
      // A page that loads late can undo the step's setup, as a draft that opens on its
      // own step. While the part is not there, the walk opens it again, a few times.
      keep: fromCallback<Event, KeepInput>(({ input }) =>
        run(
          Effect.gen(function* () {
            const step = stepAt(input.journey, input.at);
            const { setup, target } = step ?? {};
            if (setup === undefined || target === undefined) return;
            for (let tries = 0; tries < 8; tries += 1) {
              yield* Effect.sleep("700 millis");
              if (target.some((t) => document.querySelector(t) !== null)) continue;
              yield* quietly(
                "open the step's part again",
                fromResult((signal) => setup(adapter.context(), signal)),
              );
            }
          }),
        ),
      ),
      // A post ends once sent: a session the page builds again from its snapshot, as on a
      // code change, then starts no post a second time.
      post: fromCallback<Event, Post>(({ input, sendBack, self }) =>
        run(
          Effect.gen(function* () {
            for (const post of chainOf(input)) {
              const sentAt = DateTime.formatIso(yield* DateTime.now);
              yield* postLine(routes.feedback, postedLine(journeys(), post, sentAt));
            }
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() =>
                sendBack({ type: "failed", ids: chainOf(input).flatMap((post) => post.ids) }),
              ),
            ),
            Effect.ensuring(Effect.sync(() => sendBack({ type: "posted", child: self.id }))),
          ),
        ),
      ),
      poll: fromCallback<Event>(({ sendBack }) =>
        run(
          Effect.all(
            [
              readReplies(routes.status).pipe(
                Effect.tap((replies) => Effect.sync(() => sendBack({ type: "replies", replies }))),
                Effect.ignore,
              ),
              // A dev server from before the route answers 404: the page cannot tell, and
              // says nothing.
              Effect.gen(function* () {
                const listening = yield* readListening(routes.listening ?? ROUTES.listening);
                const now = yield* Clock.currentTimeMillis;
                return listenedJourneys(listening, now);
              }).pipe(
                Effect.orElseSucceed(() => undefined),
                Effect.tap((listened) =>
                  Effect.sync(() => sendBack({ type: "listening", listened })),
                ),
              ),
            ],
            { concurrency: "unbounded" },
          ).pipe(Effect.repeat(Schedule.spaced("2 seconds")), Effect.asVoid),
        ),
      ),
    },
  });
}

export type LiveMachine = ReturnType<typeof liveMachine>;
