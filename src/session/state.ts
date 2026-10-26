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
  /** The step's own variant (DevStep.variants) that the settle kept, by its label. */
  variant: Schema.optional(Schema.String),
});
export type Feedback = typeof FeedbackSchema.Type;

/** The feedback of a step opened again: not settled, and no variant kept, as the reviewer
 * may settle on another. The deleted variants stay deleted. */
export function openedAgain(f: Feedback): Feedback {
  const { variant: _, parts, ...rest } = f;
  return {
    ...rest,
    settled: false,
    ...(parts === undefined
      ? {}
      : {
          parts: Object.fromEntries(
            Object.entries(parts).map(([part, v]) => [part, { ...v, kept: [] }]),
          ),
        }),
  };
}

/** A variant of a part that a settle keeps, by the part's name and the variant's label. */
export interface Keep {
  readonly part: string;
  readonly variant: string;
}

/**
 * Whether a settle on a step that is settled keeps another variant than the one kept: of
 * the step's part, `keep`, or of the step's own, `own`. Then the settle changes the verdict;
 * else it only goes on, as the step is right as it shows.
 */
export function keepsAnother(f: Feedback, keep: Keep | undefined, own: string | undefined) {
  const kept = keep === undefined ? undefined : (f.parts?.[keep.part]?.kept ?? []);
  const part = keep !== undefined && (kept?.length !== 1 || kept[0] !== keep.variant);
  return part || (own !== undefined && own !== f.variant);
}

/** Whether two feedbacks keep the same variants: of each part, and of the step's own. */
export function keepsSame(a: Feedback | undefined, b: Feedback | undefined) {
  const keptOf = (f: Feedback | undefined) =>
    JSON.stringify([
      Object.entries(f?.parts ?? {})
        .filter(([, v]) => v.kept.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([part, v]) => [part, v.kept]),
      f?.variant,
    ]);
  return keptOf(a) === keptOf(b);
}

/** The variants that the settle of a step kept on its parts, by the part's name: a step that
 * opens shows them. None for a step that is open. */
export function keptParts(f: Feedback | undefined): Readonly<Record<string, string>> {
  if (f?.settled !== true) return {};
  return Object.fromEntries(
    Object.entries(f.parts ?? {}).flatMap(([part, v]) => {
      const variant = v.kept.at(-1);
      return variant === undefined ? [] : [[part, variant] as const];
    }),
  );
}

/**
 * The feedback as the agent knows it: the settle that waits for Finish never went, so its
 * step is open to the agent until then.
 */
export function heardFeedback(
  feedback: Readonly<Record<string, Feedback>>,
  finish: { readonly step: string } | null,
): Readonly<Record<string, Feedback>> {
  if (finish === null) return feedback;
  return { ...feedback, [finish.step]: { ...feedback[finish.step], settled: false } };
}

/**
 * The step H and L go to:`by` steps on, passing over the settled ones, as the review is
 * done with them; the panel's tree still opens them. With no open step that way, it stays.
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
  /** Whether the panel shows: hidden, the bar is its folded form. */
  panel: Schema.Boolean,
  /** The dev tools' own design, while the reviewer picks one. */
  design: Schema.String,
  /** On a step, whose chat the panel shows and Alt+click writes to: the step's or the page's. */
  chat: Schema.Literals(["step", "page"]),
  /** The tree's rows the reviewer opened or closed, by the row's fold key; a row not here
   * has its own start: open for this page and the journey walked, else closed. */
  folds: Schema.Record(Schema.String, Schema.Boolean),
  /** The last open step's settle, which waits for the reviewer to finish the review: its
   * step, and the chats whose notes went with it. Only Finish sends it, so the agent wakes
   * once. Null while nothing waits. */
  finish: Schema.NullOr(Schema.Struct({ step: Schema.String, ids: Schema.Array(Schema.String) })),
  /** The hand-off the panel shows after Finish (notes/handoff.ts), by its note's ID: what the
   * agent does with the review. Null while the panel shows the tree or a step. */
  handoff: Schema.NullOr(Schema.String),
});
export type Kept = typeof KeptSchema.Type;

export const START: Kept = {
  journey: "",
  active: false,
  at: 0,
  variants: {},
  feedback: {},
  notes: [],
  panel: true,
  design: "",
  chat: "step",
  folds: {},
  finish: null,
  handoff: null,
};

/** A journey as the machine needs it: its steps' IDs, groups and variant counts. */
export interface Shape {
  readonly id: string;
  /** Its title, as a take-back names a finished review; its ID when it has none. */
  readonly title?: string | undefined;
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
