/*
 * Where the walk is in a step's actions, kept for the tab, so a step goes on after a new page
 * load. Before each action the walk keeps the step, the phase and the action's place, and once
 * a phase ends it keeps that too, so the kept place is the first action that did not end. A
 * click on a link can load the page after its phase ended, so the place stays until the walk
 * leaves the step. On the new page the phases of the step before the kept one are done, and
 * the kept one goes on at that action. The place is read once, when the page loads, and not on
 * a reload: the reviewer's reload opens the step again from its start.
 */

/** The phases of a step, in the order the walk runs them. `exit` is not one: the walk leaves. */
const ORDER = ["enter", "reset", "setup", "variant", "ready"] as const;
export type Phase = (typeof ORDER)[number];

interface Kept {
  readonly step: string;
  readonly phase: Phase;
  /** The variant's label, in the variant's phase. */
  readonly label?: string;
  readonly next: number;
}

const isKept = (value: unknown): value is Kept =>
  typeof value === "object" &&
  value !== null &&
  "step" in value &&
  typeof value.step === "string" &&
  "phase" in value &&
  ORDER.some((p) => p === value.phase) &&
  "next" in value &&
  typeof value.next === "number";

export interface Cursor {
  /** Where a phase starts: at an action, or `skip` when a new page load came after it. */
  readonly start: (step: string, phase: Phase, label?: string) => number | "skip";
  /** Keeps the place: the actions before `next` ended. */
  readonly keep: (step: string, phase: Phase, label: string | undefined, next: number) => void;
  /** The walk left the step: no place is kept. */
  readonly clear: () => void;
}

/** Whether this page came by a reload, which opens the step again from its start. */
const reloaded = () => {
  const [entry] = performance.getEntriesByType("navigation");
  return entry instanceof PerformanceNavigationTiming && entry.type === "reload";
};

/** The tab's cursor, kept under `key`. */
export function tabCursor(key: string): Cursor {
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
    if (isKept(value) && !reloaded()) taken = value;
  } catch {
    taken = undefined;
  }
  return {
    start: (step, phase, label) => {
      const kept = taken;
      if (kept === undefined) return 0;
      if (kept.step === step && ORDER.indexOf(phase) < ORDER.indexOf(kept.phase)) return "skip";
      taken = undefined;
      return kept.step === step && phase === kept.phase && label === kept.label ? kept.next : 0;
    },
    keep: (step, phase, label, next) => {
      const kept: Kept = { step, phase, ...(label === undefined ? {} : { label }), next };
      storage()?.setItem(key, JSON.stringify(kept));
    },
    clear: () => {
      taken = undefined;
      storage()?.removeItem(key);
    },
  };
}
