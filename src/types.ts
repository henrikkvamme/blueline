import type { Effect } from "effect";

/*
 * What an app gives the dev tools: its review journeys, how to open a step's world, and
 * its own commands. Everything else, the walk, the notes, the keys and the agent channel,
 * is the dev tools' own.
 */

/** One state or design of a step's part. Applying it again does no harm. */
export interface DevVariant<C> {
  readonly label: string;
  /** A design choice to pick (choices.ts): its name and option. */
  readonly choice?: readonly [name: string, option: string];
  readonly apply?: (context: C) => Effect.Effect<void>;
}

/** Who the reviewer is in a step, as the walk shows it. */
export interface DevPerson {
  readonly name: string;
  readonly role?: string;
}

export interface DevStep<C> {
  /** Stable across edits of the journey: notes and verdicts are kept by it. */
  readonly id: string;
  readonly title: string;
  /** What to look at, in a sentence or two. */
  readonly look: string;
  /** What to try on the page, if anything. */
  readonly try?: string;
  /** The group the step is in, such as its scenario, for the sidebar. */
  readonly group: { readonly id: string; readonly title: string };
  readonly person?: DevPerson;
  /** Where the part is: CSS selectors, one for each element. The light covers them all. */
  readonly target?: readonly string[];
  /** Opens the part on the page, such as a panel. */
  readonly setup?: (context: C) => Effect.Effect<void>;
  /** Takes every variant's state off the page. It runs before a variant applies and when
   * the walk leaves the step, so no variant's state stays behind. */
  readonly reset?: (context: C) => Effect.Effect<void>;
  readonly variants?: readonly DevVariant<C>[];
  /** The name of the part to lift with v (part/variants.tsx), when the target holds more
   * than one; otherwise v lifts the one in the target. */
  readonly part?: string;
}

export interface DevJourney<C> {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly DevStep<C>[];
}

/** What shows over the page while the world of a step changes. */
export interface DevShift {
  readonly title: string;
  readonly detail?: string;
  readonly person?: DevPerson;
  readonly busy: boolean;
}

/** Something the reviewer can run from the `?` menu, or with its key. */
export interface DevCommand {
  readonly id: string;
  readonly title: string;
  readonly group?: string;
  /** The key, as KeyboardEvent.key gives it: "F" is Shift and f. */
  readonly key?: string;
  readonly run: () => void;
}

/** A person to act as, for the `a` picker. */
export interface DevPersonChoice {
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
  /** The group the picker lists the person under, as the app names it; Everyone if none. */
  readonly group?: string;
  readonly current?: boolean;
}

export interface DevAdapter<C> {
  readonly journeys: readonly DevJourney<C>[];
  /**
   * Opens the step's world: its scenario, its person and its page, and gives what the
   * step's code needs. It calls `show` while the world changes, and `show(undefined)` when
   * it is ready. It is not stopped halfway once it builds something.
   */
  readonly enter: (
    step: DevStep<C>,
    options: { readonly fresh: boolean; readonly show: (shift: DevShift | undefined) => void },
  ) => Effect.Effect<C>;
  /** The context for a step's code on the page as it is, without opening anything. */
  readonly context: () => C;
  readonly people?: {
    /** A React hook: the people who match the query, as the app reads them. */
    readonly usePeople: (query: string) => readonly DevPersonChoice[];
    readonly actAs: (id: string) => void;
  };
  readonly commands?: readonly DevCommand[];
  /** Where the dev server takes notes and serves replies (vite.ts). */
  readonly channel?: {
    readonly feedback: string;
    readonly status: string;
    readonly images?: string | undefined;
    readonly listening?: string | undefined;
  };
}

/** A step as the dev tools' parts show it, without its code. */
export type StepInfo = Omit<DevStep<never>, "setup" | "reset" | "variants"> & {
  readonly variants?: readonly { readonly label: string }[];
};

export interface JourneyInfo {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly StepInfo[];
}

/** The adapter as the dev tools' parts read it: what they show, not the code they run. */
export interface DevInfo {
  readonly journeys: readonly JourneyInfo[];
  readonly people?: DevAdapter<never>["people"];
  readonly commands?: readonly DevCommand[];
  readonly channel?: DevAdapter<never>["channel"];
}
