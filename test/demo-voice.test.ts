import { describe, expect, it } from "vitest";
import { type Line, prune } from "../examples/review-demo/voice.ts";

/* The dev server keeps the speech it made for a time, within a size, oldest out first. */

const line = (made: number, size: number): Line => ({
  chunks: [],
  made,
  size,
  done: true,
  failed: false,
  wake: new Set(),
});

describe("prune", () => {
  const keep = { bytes: 100, ms: 1000 };

  it("drops the oldest lines until the rest fit", () => {
    const lines = new Map([
      ["a", line(0, 60)],
      ["b", line(10, 30)],
      ["c", line(20, 30)],
    ]);
    prune(lines, 50, keep);
    expect([...lines.keys()]).toEqual(["b", "c"]);
  });

  it("drops the lines that are too old", () => {
    const lines = new Map([
      ["a", line(0, 1)],
      ["b", line(900, 1)],
    ]);
    prune(lines, 1500, keep);
    expect([...lines.keys()]).toEqual(["b"]);
  });

  it("keeps young lines that fit", () => {
    const lines = new Map([["a", line(0, 100)]]);
    prune(lines, 999, keep);
    expect([...lines.keys()]).toEqual(["a"]);
  });
});
