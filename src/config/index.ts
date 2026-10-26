/*
 * An app's journeys as data, in `blueline.config.ts` in its root, with no adapter code. The
 * Vite plugin's tag, or a tag by hand, gives the config to the page, where it becomes an
 * adapter (config/adapter.ts). This module has the types and `defineConfig` only, so a
 * config imports nothing of the page.
 */

/** Goes to the path with a new page load, unless the page is there already. Only the first
 * action of a step's `enter`. */
export interface OpenAction {
  readonly open: string;
}

/** Clicks the element. */
export interface ClickAction {
  readonly click: string;
}

/** Focuses the field and sets its value as the reviewer would type it. */
export interface TypeAction {
  readonly type: string;
  readonly into: string;
}

/** Sends `keydown` and `keyup` with the key to the element, or to the focused one. On a field
 * in a form, Enter that no handler stopped submits the form. */
export interface PressAction {
  readonly press: string;
  readonly on?: string;
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
}

/** Waits for the element. */
export interface WaitAction {
  readonly wait: string;
}

/** Sends a window `CustomEvent`, which the app may listen for. */
export interface EmitAction {
  readonly emit: string;
  readonly detail?: unknown;
}

export type Action = OpenAction | ClickAction | TypeAction | PressAction | WaitAction | EmitAction;

/** Code for a step: its signal aborts at the step's `timeout`, or when the walk leaves. */
export type ConfigCode = (signal: AbortSignal) => void | PromiseLike<void>;

/** Actions in their order, or code. */
export type ConfigRun = readonly Action[] | ConfigCode;

export interface ConfigVariant {
  /** Unique in its step: the review keeps the variant by it. */
  readonly label: string;
  /** Picks an option of a choice the page names, as `[name, option]`. */
  readonly choice?: readonly [name: string, option: string];
  /** Shows the variant. */
  readonly show?: ConfigRun;
}

export interface ConfigPerson {
  readonly name: string;
  readonly role?: string;
}

export interface ConfigStep {
  /** Unique across all journeys: notes, verdicts and variants are kept by it. */
  readonly id: string;
  readonly title: string;
  /** What the reviewer looks at. */
  readonly look: string;
  /** What the reviewer tries. */
  readonly try?: string;
  /** The group's ID and its title. */
  readonly group: string;
  readonly person?: ConfigPerson;
  /** The selectors of what the step shows. */
  readonly target?: readonly string[];
  /** The part the step's variants are of. */
  readonly part?: string;
  /** Opens the step's world, as a path to open and a click. */
  readonly enter?: ConfigRun;
  /** Opens the part, again before each variant. */
  readonly setup?: ConfigRun;
  /** Takes a variant's state off. */
  readonly reset?: ConfigRun;
  /** Runs when the walk leaves the step, after `reset`. */
  readonly exit?: ConfigRun;
  /** The selectors that show the step is ready, or code. */
  readonly ready?: readonly string[] | ConfigCode;
  /** How many milliseconds each of these may take: 5000 by default. */
  readonly timeout?: number;
  readonly variants?: readonly ConfigVariant[];
}

export interface ConfigJourney {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly ConfigStep[];
}

export interface BluelineConfig {
  readonly journeys: readonly ConfigJourney[];
}

/** Gives the config back, with its types checked. */
export const defineConfig = (config: BluelineConfig): BluelineConfig => config;
