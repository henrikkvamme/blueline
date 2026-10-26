import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  KeptSchema,
  openPlace,
  placed,
  START,
  stepBy,
  withPlace,
  type Shape,
} from "../src/session/state";

describe("the step h and l go to", () => {
  const steps = ["a", "b", "c", "d"];
  const settled = { b: { settled: true }, d: { settled: true } };

  it("passes over the settled steps", () => {
    expect(stepBy(steps, settled, 0, 1)).toBe(2);
    expect(stepBy(steps, settled, 2, -1)).toBe(0);
  });

  it("stays when no open step is left that way", () => {
    expect(stepBy(steps, settled, 2, 1)).toBe(2);
    expect(stepBy(steps, settled, 0, -1)).toBe(0);
  });

  it("leaves a settled step it is on", () => {
    expect(stepBy(steps, settled, 1, 1)).toBe(2);
    expect(stepBy(steps, settled, 3, -1)).toBe(2);
  });

  it("goes one step at a time when nothing is settled", () => {
    expect(stepBy(steps, {}, 1, 1)).toBe(2);
    expect(stepBy(steps, {}, 1, 2)).toBe(3);
  });
});

describe("where the bar says the step is", () => {
  const steps = ["a", "b", "c", "d"];
  const settled = { b: { settled: true }, d: { settled: true } };

  it("counts only the open steps", () => {
    expect(openPlace(steps, settled, 0)).toEqual({ place: 1, open: 2 });
    expect(openPlace(steps, settled, 2)).toEqual({ place: 2, open: 2 });
  });

  it("gives a settled step no place", () => {
    expect(openPlace(steps, settled, 1)).toEqual({ place: undefined, open: 2 });
  });

  it("counts every step when nothing is settled", () => {
    expect(openPlace(steps, {}, 3)).toEqual({ place: 4, open: 4 });
  });
});

describe("a review kept by an older version", () => {
  it("keeps the settled steps of feedback that still has a picked variant", () => {
    const old: unknown = JSON.parse('{ "a": { "settled": true, "picked": "Card" } }');
    const read = Schema.decodeUnknownOption(KeptSchema.fields.feedback)(old);
    expect(Option.getOrUndefined(read)?.["a"]?.settled).toBe(true);
  });
});

describe("the place kept across a changed config", () => {
  const shape = (...steps: readonly [id: string, variants: readonly string[]][]): Shape[] => [
    { id: "j", steps: steps.map(([id, variants]) => ({ id, group: "g", variants })) },
  ];
  const before = shape(["a", []], ["b", ["One", "Two"]], ["c", []]);
  const kept = withPlace({ ...START, journey: "j", at: 1, variants: { b: 1 } }, before);

  it("keeps the step by its ID and each variant by its label", () => {
    expect(kept).toMatchObject({ step: "b", labels: { b: "Two" } });
    const after = placed(kept, shape(["c", []], ["b", ["Two", "One", "Three"]], ["a", []]));
    expect(after).toMatchObject({ at: 1, variants: { b: 0 } });
  });

  it("takes the place the step had when it is gone, and the first variant when its is", () => {
    expect(placed(kept, shape(["a", []], ["x", []], ["b", ["Three"]]))).toMatchObject({
      at: 2,
      variants: { b: 0 },
    });
    expect(placed(kept, shape(["a", []], ["x", []]))).toMatchObject({ at: 1 });
    expect(placed({ ...kept, at: 5 }, shape(["x", []]))).toMatchObject({ at: 0 });
  });

  it("reads a review kept by place only, as before", () => {
    const old = { ...START, journey: "j", at: 2, variants: { b: 1 } };
    expect(placed(old, before)).toMatchObject({ at: 2, variants: { b: 1 } });
  });
});
