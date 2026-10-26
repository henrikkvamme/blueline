import { describe, expect, it } from "vitest";
import { liftActionLabel, liftActions } from "../src/part/lift-actions";

const three = ["Table", "Cards", "Dense list"];

describe("the lift's ⋯ menu", () => {
  it("holds Delete, Annotate, Undo and Zoom, in that order", () => {
    expect(liftActions({ variants: three, noted: [], notes: true })).toEqual([
      "delete",
      "note",
      "undo",
      "zoom",
    ]);
  });

  it("has no Delete for the last variant, as a part shows one", () => {
    expect(liftActions({ variants: ["Table"], noted: [], notes: true })).not.toContain("delete");
  });

  it("has no Annotate where the lift takes no annotations", () => {
    expect(liftActions({ variants: three, noted: [], notes: false })).not.toContain("note");
  });

  it("has Next annotation only while a variant left has an annotation", () => {
    expect(liftActions({ variants: three, noted: ["Cards"], notes: true })).toEqual([
      "delete",
      "note",
      "next-note",
      "undo",
      "zoom",
    ]);
    expect(liftActions({ variants: three, noted: ["Deleted one"], notes: true })).not.toContain(
      "next-note",
    );
  });

  it("has no Delete or Undo where the lift deletes nothing, as a step's own variants", () => {
    expect(liftActions({ variants: three, noted: [], notes: false, deletes: false })).toEqual([
      "zoom",
    ]);
  });

  it("names the zoom by what it goes to, and the annotations as the reviewer calls them", () => {
    expect(liftActionLabel("zoom", false)).toBe("Zoom");
    expect(liftActionLabel("zoom", true)).toBe("True size");
    expect(liftActionLabel("note", false)).toBe("Annotate");
    expect(liftActionLabel("next-note", false)).toBe("Next annotation");
  });
});
