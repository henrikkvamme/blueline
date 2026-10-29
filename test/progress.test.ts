import { describe, expect, it } from "vitest";
import { allSettled, MAX_DOTS, progressOf } from "../src/ui/progress";

/** Which of `steps` steps are settled: those whose numbers, from 0, are given. */
const settledAt = (steps: number, ...done: number[]) =>
  Array.from({ length: steps }, (_, i) => done.includes(i));

describe("the journey's progress", () => {
  it("shows a dot for each step up to ten steps", () => {
    expect(MAX_DOTS).toBe(10);
    expect(progressOf(settledAt(2), 0, false)).toEqual({ look: "dots" });
    expect(progressOf(settledAt(10, 0, 1, 2), 4, false)).toEqual({ look: "dots" });
  });

  it("shows a bar past ten steps: the settled runs, the step's place and its number", () => {
    expect(progressOf(settledAt(11), 0, false).look).toBe("bar");
    expect(progressOf(settledAt(14, 0, 1, 2, 3, 4, 5, 6), 2, false)).toEqual({
      look: "bar",
      settled: [{ from: 0, width: 7 / 14 }],
      place: { from: 2 / 14, width: 1 / 14 },
      label: "3 of 14",
    });
  });

  it("leaves a gap for each step that is not settled", () => {
    const shape = progressOf(settledAt(11, 0, 1, 2, 3, 5, 6, 7, 8, 10), 4, false);
    expect(shape).toMatchObject({
      settled: [
        { from: 0, width: 4 / 11 },
        { from: 5 / 11, width: 4 / 11 },
        { from: 10 / 11, width: 1 / 11 },
      ],
      label: "5 of 11",
    });
    expect(progressOf(settledAt(12), 0, false)).toMatchObject({ settled: [] });
  });

  it("marks no step at the finish, and counts every step", () => {
    expect(progressOf(settledAt(14, ...Array.from({ length: 14 }, (_, i) => i)), 13, true)).toEqual(
      {
        look: "bar",
        settled: [{ from: 0, width: 1 }],
        place: undefined,
        label: "14 of 14",
      },
    );
  });

  it("keeps the step's place on the bar when the walk stands past its end", () => {
    expect(progressOf(settledAt(12), 40, false)).toMatchObject({ label: "12 of 12" });
  });
});

describe("the finish's words", () => {
  it("count the steps, and say one step in the singular", () => {
    expect(allSettled(5)).toBe("All 5 steps settled");
    expect(allSettled(1)).toBe("The step is settled");
  });
});
