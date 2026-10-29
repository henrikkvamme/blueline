/*
 * The journey's progress at the panel's top. A short journey shows a dot for each step. A
 * long one would push the title out, so past `MAX_DOTS` steps it shows a thin bar and the
 * step's number in the same room: each run of settled steps in green at its place, with a gap
 * for each step not settled, and the step's place in blue.
 */

/** The most steps that show as dots; a journey with more shows a bar. */
export const MAX_DOTS = 10;

/** A stretch of the bar, as shares of it: where it starts and how wide it is. */
export interface Stretch {
  readonly from: number;
  readonly width: number;
}

export type Progress =
  | { readonly look: "dots" }
  | {
      readonly look: "bar";
      /** Each run of settled steps, from left to right. */
      readonly settled: readonly Stretch[];
      /** The step shown; none at the finish, where no step shows. */
      readonly place: Stretch | undefined;
      /** The step's number and the steps, as "3 of 14"; at the finish, every step. */
      readonly label: string;
    };

/** How the progress of a journey shows: `settled` says of each step whether it is settled,
 * `at` is the step shown, and `finishing` says that the panel shows the finish in place of a
 * step. */
export function progressOf(settled: readonly boolean[], at: number, finishing: boolean): Progress {
  const steps = settled.length;
  if (steps <= MAX_DOTS) return { look: "dots" };
  const here = finishing ? undefined : Math.min(Math.max(at, 0), steps - 1);
  return {
    look: "bar",
    settled: runsOf(settled).map(({ from, width }) => ({
      from: from / steps,
      width: width / steps,
    })),
    place: here === undefined ? undefined : { from: here / steps, width: 1 / steps },
    label: `${String(here === undefined ? steps : here + 1)} of ${String(steps)}`,
  };
}

/** The runs of settled steps, in steps: where each starts and how many it holds. */
function runsOf(settled: readonly boolean[]): Stretch[] {
  const runs: Stretch[] = [];
  settled.forEach((done, i) => {
    if (!done) return;
    const last = runs.at(-1);
    if (last !== undefined && last.from + last.width === i)
      runs[runs.length - 1] = { from: last.from, width: last.width + 1 };
    else runs.push({ from: i, width: 1 });
  });
  return runs;
}

/** The finish's words for a journey with every step settled. A page review often has one. */
export const allSettled = (steps: number) =>
  steps === 1 ? "The step is settled" : `All ${String(steps)} steps settled`;
