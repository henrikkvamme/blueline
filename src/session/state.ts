import { Schema } from "effect";
import { NoteSchema } from "../notes/note";

/*
 * What a review keeps across pages, rebuilds and reloads: where the reviewer is, which
 * variant each step shows, which steps are settled, the verdicts on parts, and the notes.
 */

/** What the reviewer said of a part's variants (part/variants.tsx), by their labels. */
const VerdictsSchema = Schema.Struct({
  kept: Schema.Array(Schema.String),
  dropped: Schema.Array(Schema.String),
});
export type PartVerdicts = typeof VerdictsSchema.Type;

const FeedbackSchema = Schema.Struct({
  /** Whether the reviewer said the step is right: the agent stops on it. */
  settled: Schema.optional(Schema.Boolean),
  /** The variants kept and deleted in the step's parts, by the part's name. */
  parts: Schema.optional(Schema.Record(Schema.String, VerdictsSchema)),
});
export type Feedback = typeof FeedbackSchema.Type;

/**
 * The step h and l go to: `by` steps on, passing over the settled ones, as the review is
 * done with them; the sidebar still opens them. With no open step that way, it stays.
 */
export function stepBy(
  steps: readonly string[],
  feedback: Readonly<Record<string, Feedback>>,
  at: number,
  by: number,
): number {
  const way = Math.sign(by);
  let left = Math.abs(by);
  let to = at;
  for (let i = at + way; left > 0 && i >= 0 && i < steps.length; i += way)
    if (feedback[steps[i] ?? ""]?.settled !== true) {
      to = i;
      left -= 1;
    }
  return to;
}

export const KeptSchema = Schema.Struct({
  journey: Schema.String,
  active: Schema.Boolean,
  at: Schema.Finite,
  /** Each step's variant, by step ID. */
  variants: Schema.Record(Schema.String, Schema.Finite),
  feedback: Schema.Record(Schema.String, FeedbackSchema),
  notes: Schema.Array(NoteSchema),
  sidebar: Schema.Boolean,
  /** The dev tools' own design, while the reviewer picks one. */
  design: Schema.String,
  /** Whether the page's card is open, for the page's chat off a step. */
  page: Schema.Boolean,
  /** On a step, whose chat the card shows and Alt+click writes to: the step's or the page's. */
  chat: Schema.Literals(["step", "page"]),
  /** The sidebar's rows the reviewer opened or closed, by the row's fold key; a row not here
   * has its own start: open for this page and the journey walked, else closed. */
  folds: Schema.Record(Schema.String, Schema.Boolean),
});
export type Kept = typeof KeptSchema.Type;

export const START: Kept = {
  journey: "",
  active: false,
  at: 0,
  variants: {},
  feedback: {},
  notes: [],
  sidebar: false,
  design: "",
  page: false,
  chat: "step",
  folds: {},
};

/** A journey as the machine needs it: its steps' IDs, groups and variant counts. */
export interface Shape {
  readonly id: string;
  readonly steps: readonly {
    readonly id: string;
    readonly group: string;
    readonly variants: readonly string[];
  }[];
}

/** What the walk last opened: the step it leaves takes its variants' state off. */
export interface Entered {
  readonly journey: string;
  readonly at: number;
  readonly variant: number;
  readonly run: number;
}

/** The first step not settled, where a journey's work is left; with none, the first step. */
export const firstOpen = (
  steps: readonly string[],
  feedback: Readonly<Record<string, Feedback>>,
): number =>
  Math.max(
    0,
    steps.findIndex((id) => feedback[id]?.settled !== true),
  );

/** The last step not settled; with none, the last step. */
export const lastOpen = (
  steps: readonly string[],
  feedback: Readonly<Record<string, Feedback>>,
): number => {
  const open = steps.flatMap((id, i) => (feedback[id]?.settled === true ? [] : [i]));
  return open.at(-1) ?? Math.max(0, steps.length - 1);
};

/**
 * Where the step is among the open steps, the ones not settled, from 1, and how many are
 * open: the bar counts the work left. A settled step has no place.
 */
export function openPlace(
  steps: readonly string[],
  feedback: Readonly<Record<string, Feedback>>,
  at: number,
): { readonly place: number | undefined; readonly open: number } {
  const open = steps.filter((id) => feedback[id]?.settled !== true);
  const id = steps[at];
  const i = id === undefined ? -1 : open.indexOf(id);
  return { place: i === -1 ? undefined : i + 1, open: open.length };
}
