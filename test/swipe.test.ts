import { describe, expect, it } from "vitest";
import { SWIPE_DISTANCE, SWIPE_EDGE, swipeOf, swipeStarts } from "../src/ui/swipe";

const at = { x: 200, y: 400 };
const by = (x: number, y: number) => ({ x: at.x + x, y: at.y + y });

describe("a swipe on the part under review", () => {
  it("shows the next variant when the finger goes left", () => {
    expect(swipeOf(at, by(-80, 6))).toBe(1);
  });

  it("shows the previous variant when the finger goes right", () => {
    expect(swipeOf(at, by(80, -6))).toBe(-1);
  });

  it("counts from the threshold on, not before", () => {
    expect(swipeOf(at, by(-(SWIPE_DISTANCE - 1), 0))).toBeUndefined();
    expect(swipeOf(at, by(-SWIPE_DISTANCE, 0))).toBe(1);
  });

  it("leaves a scroll up or down to the page", () => {
    expect(swipeOf(at, by(10, -200))).toBeUndefined();
    expect(swipeOf(at, by(-60, 300))).toBeUndefined();
  });

  it("is no swipe when the finger goes as far across as along", () => {
    expect(swipeOf(at, by(-90, 70))).toBeUndefined();
    expect(swipeOf(at, by(-90, 50))).toBe(1);
  });

  it("goes over the states on the y axis: up for the next, down for the previous", () => {
    expect(swipeOf(at, by(4, -90), "y")).toBe(1);
    expect(swipeOf(at, by(-4, 90), "y")).toBe(-1);
    expect(swipeOf(at, by(-90, 4), "y")).toBeUndefined();
  });

  it("does not start at the screen's side edges, where the browser goes back", () => {
    expect(swipeStarts({ x: SWIPE_EDGE - 1, y: 300 }, 390)).toBe(false);
    expect(swipeStarts({ x: 390 - SWIPE_EDGE + 1, y: 300 }, 390)).toBe(false);
    expect(swipeStarts({ x: 195, y: 300 }, 390)).toBe(true);
  });
});
