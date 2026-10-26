/*
 * Where the walk is in a step's actions, kept for the tab, so a step goes on after a new page
 * load. Before each action the walk keeps the step, the phase and the action's place, so the
 * kept place is the first action that did not end. On the new page the phases of the step
 * before the kept one are done already, and the kept one goes on at that action. The place is
 * read once, when the page loads, and is used once.
 */

/** The phases of a step, in the order the walk runs them. `exit` is not one: the walk leaves. */
const ORDER = ["enter", "reset", "setup", "variant", "ready"] as const;
export type Phase = (typeof ORDER)[number];

/** How long a kept place counts after the page that kept it, in ms. */
const RESUME_MS = 60_000;

interface Kept {
  readonly step: string;
  readonly phase: Phase;
  /** The variant's label, in the variant's phase. */
  readonly label?: string;
  readonly next: number;
  readonly at: number;
}

const isKept = (value: unknown): value is Kept =>
  typeof value === "object" &&
  value !== null &&
  "step" in value &&
  typeof value.step === "string" &&
  "phase" in value &&
  ORDER.some((p) => p === value.phase) &&
  "next" in value &&
  typeof value.next === "number" &&
  "at" in value &&
  typeof value.at === "number";

export interface Cursor {
  /** Where a phase starts: at an action, or `skip` when a new page load came after it. */
  readonly start: (step: string, phase: Phase, label?: string) => number | "skip";
  /** Keeps the place before an action. */
  readonly keep: (step: string, phase: Phase, label: string | undefined, next: number) => void;
  /** The phase ended, or the walk left it: no place is kept. */
  readonly clear: () => void;
}

/** The tab's cursor, kept under `key`. */
export function tabCursor(key: string, now: () => number = Date.now): Cursor {
  const storage = (): Storage | undefined => {
    try {
      return sessionStorage;
    } catch {
      return undefined;
    }
  };
  let taken: Kept | undefined;
  try {
    const value: unknown = JSON.parse(storage()?.getItem(key) ?? "null");
    if (isKept(value) && now() - value.at <= RESUME_MS) taken = value;
  } catch {
    taken = undefined;
  }
  storage()?.removeItem(key);
  return {
    start: (step, phase, label) => {
      const kept = taken;
      if (kept === undefined) return 0;
      const order = ORDER.indexOf(phase);
      const keptOrder = ORDER.indexOf(kept.phase);
      if (kept.step === step && order < keptOrder) return "skip";
      taken = undefined;
      return kept.step === step && phase === kept.phase && label === kept.label ? kept.next : 0;
    },
    keep: (step, phase, label, next) => {
      const kept: Kept = {
        step,
        phase,
        ...(label === undefined ? {} : { label }),
        next,
        at: now(),
      };
      storage()?.setItem(key, JSON.stringify(kept));
    },
    clear: () => storage()?.removeItem(key),
  };
}
