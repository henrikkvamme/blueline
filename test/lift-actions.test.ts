import { describe, expect, it } from "vitest";
import { liftActionLabel, liftActions } from "../src/part/lift-actions";

const three = ["Table", "Cards", "Dense list"];

describe("the lift's ⋯ menu", () => {
  it("holds Delete, Note, Undo and Zoom, in that order", () => {
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

  it("has no Note where the lift takes no notes", () => {
    expect(liftActions({ variants: three, noted: [], notes: false })).not.toContain("note");
  });

  it("has Next note only while a variant left has a note", () => {
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

  it("names the zoom by what it goes to", () => {
    expect(liftActionLabel("zoom", false)).toBe("Zoom");
    expect(liftActionLabel("zoom", true)).toBe("True size");
    expect(liftActionLabel("next-note", false)).toBe("Next note");
  });
});
