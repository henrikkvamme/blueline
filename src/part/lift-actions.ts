/*
 * What the lift's ⋯ menu holds. The bar keeps the part's name, the variant and the state,
 * Use and Close; the other actions wait in the menu, and each keeps its key.
 */

export type LiftAction = "delete" | "note" | "next-note" | "undo" | "zoom";

/** The menu's actions, in order: Delete while more than one variant is left, as a part
 * shows one; Note where the lift takes notes; Next note while a variant left has a note;
 * Undo and Zoom always. */
export function liftActions({
  variants,
  noted,
  notes,
}: {
  /** The variants left. */
  readonly variants: readonly string[];
  /** The variants with a note. */
  readonly noted: readonly string[];
  /** Whether the lift takes notes. */
  readonly notes: boolean;
}): readonly LiftAction[] {
  const actions: LiftAction[] = [];
  if (variants.length > 1) actions.push("delete");
  if (notes) actions.push("note");
  if (noted.some((label) => variants.includes(label))) actions.push("next-note");
  actions.push("undo", "zoom");
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
