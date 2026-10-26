/*
 * The panel's one hint. A page with no journey to walk and no part to review gives the
 * reviewer nothing to do in the design, and the design cannot teach Alt+click. So the page's
 * empty chat says it, in one quiet line, until the chat has a message or a note.
 */

export const EMPTY_HINT = "Alt+click anything to annotate it.";

/** Whether the page's chat shows the hint. */
export const hintShows = (page: {
  /** The journeys the tree lists: the app's own, and the page's review when it has parts. */
  readonly journeys: number;
  /** The parts with variants that the page shows. */
  readonly parts: number;
  /** The messages in the page's chat. */
  readonly messages: number;
  /** The pointed notes on the page not sent yet. */
  readonly notes: number;
}): boolean => page.journeys === 0 && page.parts === 0 && page.messages === 0 && page.notes === 0;
