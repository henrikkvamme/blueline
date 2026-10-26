/*
 * What the lift's ⋯ menu holds. The bar keeps the part's name, the variant and the state,
 * Use and Close; the other actions wait in the menu, and each keeps its key.
 */

export type LiftAction = "delete" | "note" | "next-note" | "undo" | "zoom";

/** The menu's actions, in order: Delete where the lift deletes, while more than one variant
 * is left, as a part shows one; Note where the lift takes notes; Next note while a variant
 * left has a note; Undo where the lift deletes, and Zoom always. */
export function liftActions({
  variants,
  noted,
  notes,
  deletes = true,
}: {
  /** The variants left. */
  readonly variants: readonly string[];
  /** The variants with a note. */
  readonly noted: readonly string[];
  /** Whether the lift takes notes. */
  readonly notes: boolean;
  /** Whether the lift deletes variants: a step's own variants have no verdicts. */
  readonly deletes?: boolean;
}): readonly LiftAction[] {
  const actions: LiftAction[] = [];
  if (deletes && variants.length > 1) actions.push("delete");
  if (notes) actions.push("note");
  if (noted.some((label) => variants.includes(label))) actions.push("next-note");
  if (deletes) actions.push("undo");
  actions.push("zoom");
  return actions;
}

/** An action's words: the zoom says what it goes to. */
export function liftActionLabel(action: LiftAction, zoomed: boolean): string {
  switch (action) {
    case "delete":
      return "Delete";
    case "note":
      return "Annotate";
    case "next-note":
      return "Next annotation";
    case "undo":
      return "Undo";
    case "zoom":
      return zoomed ? "True size" : "Zoom";
  }
}
