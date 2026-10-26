/*
 * The journey's progress at the panel's top. A short journey shows a dot for each step. A
 * long one would push the title out, so past `MAX_DOTS` steps it shows a thin bar and the
 * step's number in the same room: the settled share in green, and the step's place in blue.
 */

/** The most steps that show as dots; a journey with more shows a bar. */
export const MAX_DOTS = 10;

export type Progress =
  | { readonly look: "dots" }
  | {
      readonly look: "bar";
      /** The share of the steps settled, from 0 to 1. */
      readonly settled: number;
      /** Where the step shown starts and how wide it is, as shares of the bar; none at the
       * finish, where no step shows. */
      readonly place: { readonly from: number; readonly width: number } | undefined;
      /** The step's number and the steps, as "3 of 14"; at the finish, every step. */
      readonly label: string;
    };

/** How the progress of a journey shows: `at` is the step shown, and `finishing` says that the
 * panel shows the finish in place of a step. */
export function progressOf(
  steps: number,
  settled: number,
  at: number,
  finishing: boolean,
): Progress {
  if (steps <= MAX_DOTS) return { look: "dots" };
  const here = finishing ? undefined : Math.min(Math.max(at, 0), steps - 1);
  return {
    look: "bar",
    settled: Math.min(Math.max(settled / steps, 0), 1),
    place: here === undefined ? undefined : { from: here / steps, width: 1 / steps },
    label: `${String(here === undefined ? steps : here + 1)} of ${String(steps)}`,
  };
}

/** The finish's words for a journey with every step settled. A page review often has one. */
export const allSettled = (steps: number) =>
  steps === 1 ? "The step is settled" : `All ${String(steps)} steps settled`;
