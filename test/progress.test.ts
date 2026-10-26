import { describe, expect, it } from "vitest";
import { MAX_DOTS, progressOf } from "../src/ui/progress";

describe("the journey's progress", () => {
  it("shows a dot for each step up to ten steps", () => {
    expect(MAX_DOTS).toBe(10);
    expect(progressOf(2, 0, 0, false)).toEqual({ look: "dots" });
    expect(progressOf(10, 3, 4, false)).toEqual({ look: "dots" });
  });

  it("shows a bar past ten steps: the settled share, the step's place and its number", () => {
    expect(progressOf(11, 0, 0, false).look).toBe("bar");
    expect(progressOf(14, 7, 2, false)).toEqual({
      look: "bar",
      settled: 0.5,
      place: { from: 2 / 14, width: 1 / 14 },
      label: "3 of 14",
    });
  });

  it("marks no step at the finish, and counts every step", () => {
    expect(progressOf(14, 14, 13, true)).toEqual({
      look: "bar",
      settled: 1,
      place: undefined,
      label: "14 of 14",
    });
  });

  it("keeps the step's place on the bar when the walk stands past its end", () => {
    expect(progressOf(12, 0, 40, false)).toMatchObject({ label: "12 of 12" });
  });
});
