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

/** One thing a phase does: an action, a function or the wait for `ready`'s selectors. */
type Unit = (signal: AbortSignal, doing: Doing) => Promise<void>;

/** Where a phase is in the step; `exit` has none, as the walk leaves the step. */
interface Place {
  readonly step: string;
  readonly phase: Phase;
  readonly label?: string;
}

/**
 * Runs one phase until the step's timeout: its units from where the cursor says, keeping the
 * place before each and once all ended. `exit` keeps no place: the walk leaves the step, so
 * no new page load takes it up.
 */
function phaseCode(
  cursor: Cursor,
  place: Place | undefined,
  timeout: number,
  units: readonly Unit[],
): Code {
  return async (_context, walk) => {
    const start = place === undefined ? 0 : cursor.start(place.step, place.phase, place.label);
    if (start === "skip") return;
    const keep = (next: number) => {
      if (place !== undefined) cursor.keep(place.step, place.phase, place.label, next);
    };
    const own = new AbortController();
    const leave = () => own.abort(walk.reason);
    walk.addEventListener("abort", leave, { once: true });
    let doing = "it";
    const said = (what: string) => (doing = what);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, fail) => {
      timer = setTimeout(() => {
        own.abort();
        fail(new Error(`${doing} in ${seconds(timeout)}`));
      }, timeout);
    });
    // A phase the walk left, or that was too late, runs and keeps nothing more, as a function
    // may end after its signal aborted.
    const run = async () => {
      for (const [i, unit] of units.entries()) {
        if (own.signal.aborted) return;
        if (i < start) continue;
        keep(i);
        said("the action");
        await unit(own.signal, said);
      }
      if (!own.signal.aborted) keep(units.length);
    };
    try {
      await Promise.race([run(), late]);
      if (place === undefined) cursor.clear();
    } catch (error) {
      // The walk left the step: no place stays.
      if (walk.aborted || place === undefined) cursor.clear();
      throw error;
    } finally {
      clearTimeout(timer);
      walk.removeEventListener("abort", leave);
    }
  };
}

const ofCode =
  (code: ConfigCode): Unit =>
  async (signal, doing) => {
    doing("the function did not end");
    await code(signal);
  };

const unitsOf = (run: ConfigRun | undefined): readonly Unit[] =>
  run === undefined
    ? []
    : typeof run === "function"
      ? [ofCode(run)]
      : run.map(
          (action): Unit =>
            (signal, doing) =>
              runAction(action, signal, doing),
        );

const readyOf = (ready: NonNullable<ConfigStep["ready"]>): readonly Unit[] =>
  typeof ready === "function"
    ? [ofCode(ready)]
    : [
        async (signal, doing) => {
          for (const selector of ready) await waitFor(selector, signal, doing);
        },
      ];

/** The config's step as the walk runs it. */
function stepOf(cursor: Cursor, step: ConfigStep): DevStep<void> {
  const timeout = step.timeout ?? TIMEOUT_MS;
  const code = (phase: Phase, units: readonly Unit[]) =>
    phaseCode(cursor, { step: step.id, phase }, timeout, units);
  const variants = step.variants?.map((variant): DevVariant<void> => {
    const place = { step: step.id, phase: "variant" as const, label: variant.label };
    return {
      label: variant.label,
      ...(variant.choice === undefined ? {} : { choice: variant.choice }),
      ...(variant.show === undefined
        ? {}
        : { apply: phaseCode(cursor, place, timeout, unitsOf(variant.show)) }),
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
    ...(step.setup === undefined ? {} : { setup: code("setup", unitsOf(step.setup)) }),
    ...(step.reset === undefined ? {} : { reset: code("reset", unitsOf(step.reset)) }),
    ...(step.ready === undefined ? {} : { ready: code("ready", readyOf(step.ready)) }),
    // Each step has an exit, as leaving the step drops the place the tab keeps.
    exit: phaseCode(cursor, undefined, timeout, unitsOf(step.exit)),
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
      await phaseCode(cursor, place, timeout, unitsOf(run))(undefined, signal);
    },
    ...(channel === undefined ? {} : { channel }),
  };
}
