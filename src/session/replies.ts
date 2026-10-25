import { needsYou, type Note } from "../notes/note";

/*
 * Where the agent's replies are, so the reviewer goes through them in the journey's order:
 * the sidebar marks each step with one, and n goes to the next.
 */

/** Whether the note has a reply the reviewer has not dealt with. */
export const hasNews = (n: Note) => needsYou(n) || n.unread;

/** The step's notes with news: the step's own note first, then its pointed notes. */
export const newsOn = (notes: readonly Note[], step: string) =>
  notes
    .filter((n) => n.step === step && hasNews(n))
    .sort((a, b) => Number(a.pin !== undefined) - Number(b.pin !== undefined));

/** The first step with news after step `at`, round to the start, and its first such note.
 * The step at `at` comes last, so n moves on from the reply the reviewer reads. */
export function nextNews(
  notes: readonly Note[],
  steps: readonly string[],
  at: number,
): { readonly at: number; readonly note: Note } | undefined {
  for (let i = 1; i <= steps.length; i += 1) {
    const index = (at + i) % steps.length;
    const note = newsOn(notes, steps[index] ?? "")[0];
    if (note !== undefined) return { at: index, note };
  }
  return undefined;
}
