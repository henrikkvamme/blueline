import type { DevAdapter, DevJourney, DevStep, DevVariant } from "../types";
import { runAction, waitFor, type Doing } from "./actions";
import { tabCursor, type Cursor, type Phase } from "./cursor";
import type { BluelineConfig, ConfigCode, ConfigRun, ConfigStep } from "./index";

/*
 * A config as an adapter, so the walk runs it as it runs an adapter in code. Each phase of a
 * step has the step's `timeout`, and a phase too late says what it waited for.
 */

/** How long each phase of a step may take, by default, in ms. */
export const TIMEOUT_MS = 5000;

const seconds = (ms: number) => `${String(Math.round(ms / 100) / 10)} s`;

type Code = (context: void, signal: AbortSignal) => Promise<void>;

/** Where a phase is in the step; `exit` has none, as the walk leaves the step. */
interface Place {
  readonly step: string;
  readonly phase: Phase;
  readonly label?: string;
}

/** Runs one phase: its actions from where the cursor says, or its function, until the step's
 * timeout. */
function phaseCode(
  cursor: Cursor,
  place: Place | undefined,
  timeout: number,
  run: (signal: AbortSignal, doing: Doing, start: number) => Promise<void>,
): Code {
  return async (_context, walk) => {
    const start = place === undefined ? 0 : cursor.start(place.step, place.phase, place.label);
    if (start === "skip") return;
    const own = new AbortController();
    const leave = () => own.abort(walk.reason);
    walk.addEventListener("abort", leave, { once: true });
    let doing = "it";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, fail) => {
      timer = setTimeout(() => {
        own.abort();
        fail(new Error(`${doing} in ${seconds(timeout)}`));
      }, timeout);
    });
    try {
      await Promise.race([run(own.signal, (what) => (doing = what), start), late]);
      cursor.clear();
    } catch (error) {
      // The walk left the step: no place stays.
      if (walk.aborted) cursor.clear();
      throw error;
    } finally {
      clearTimeout(timer);
      walk.removeEventListener("abort", leave);
    }
  };
}

const ofRun =
  (cursor: Cursor, place: Place | undefined, run: ConfigRun) =>
  (signal: AbortSignal, doing: Doing, start: number): Promise<void> => {
    if (typeof run === "function") return ofCode(run, signal, doing);
    return (async () => {
      for (const [i, action] of run.entries()) {
        if (i < start) continue;
        if (place !== undefined) cursor.keep(place.step, place.phase, place.label, i);
        doing("the action");
        await runAction(action, signal, doing);
      }
    })();
  };

const ofCode = async (code: ConfigCode, signal: AbortSignal, doing: Doing) => {
  doing("the function did not end");
  await code(signal);
};

const ofReady =
  (ready: NonNullable<ConfigStep["ready"]>) =>
  async (signal: AbortSignal, doing: Doing): Promise<void> => {
    if (typeof ready === "function") return ofCode(ready, signal, doing);
    for (const selector of ready) await waitFor(selector, signal, doing);
  };

/** The config's step as the walk runs it. */
function stepOf(cursor: Cursor, step: ConfigStep): DevStep<void> {
  const timeout = step.timeout ?? TIMEOUT_MS;
  const code = (phase: Phase, run: ConfigRun | undefined) => {
    if (run === undefined) return {};
    const place = { step: step.id, phase };
    return { [phase]: phaseCode(cursor, place, timeout, ofRun(cursor, place, run)) };
  };
  const variants = step.variants?.map((variant): DevVariant<void> => {
    const place = { step: step.id, phase: "variant" as const, label: variant.label };
    return {
      label: variant.label,
      ...(variant.choice === undefined ? {} : { choice: variant.choice }),
      ...(variant.show === undefined
        ? {}
        : { apply: phaseCode(cursor, place, timeout, ofRun(cursor, place, variant.show)) }),
    };
  });
  return {
    id: step.id,
    title: step.title,
    look: step.look,
    group: { id: step.group, title: step.group },
    ...(step.try === undefined ? {} : { try: step.try }),
    ...(step.person === undefined ? {} : { person: step.person }),
    ...(step.target === undefined ? {} : { target: step.target }),
    ...(step.part === undefined ? {} : { part: step.part }),
    ...code("setup", step.setup),
    ...code("reset", step.reset),
    ...(step.ready === undefined
      ? {}
      : {
          ready: phaseCode(cursor, { step: step.id, phase: "ready" }, timeout, ofReady(step.ready)),
        }),
    // The walk leaves the step, so no new page load takes its place up.
    ...(step.exit === undefined
      ? {}
      : { exit: phaseCode(cursor, undefined, timeout, ofRun(cursor, undefined, step.exit)) }),
    ...(variants === undefined ? {} : { variants }),
  };
}

export interface ConfigAdapterOptions {
  /** Where the tab keeps the walk's place in a step. */
  readonly storageKey: string;
  readonly channel?: DevAdapter<void>["channel"];
}

/** The config as an adapter for `mount`. */
export function configAdapter(
  config: BluelineConfig,
  { storageKey, channel }: ConfigAdapterOptions,
): DevAdapter<void> {
  const cursor = tabCursor(`${storageKey}.walk`);
  const steps = new Map(config.journeys.flatMap((j) => j.steps.map((s) => [s.id, s] as const)));
  const journeys = config.journeys.map((journey): DevJourney<void> => ({
    id: journey.id,
    title: journey.title,
    steps: journey.steps.map((step) => stepOf(cursor, step)),
  }));
  return {
    journeys,
    context: () => undefined,
    enter: async (step, { signal }) => {
      const run = steps.get(step.id)?.enter;
      if (run === undefined) return;
      const timeout = steps.get(step.id)?.timeout ?? TIMEOUT_MS;
      const place = { step: step.id, phase: "enter" as const };
      await phaseCode(cursor, place, timeout, ofRun(cursor, place, run))(undefined, signal);
    },
    ...(channel === undefined ? {} : { channel }),
  };
}
