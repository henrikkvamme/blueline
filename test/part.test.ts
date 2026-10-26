import { describe, expect, it } from "vitest";
import { merge } from "../src/part/merge";
import { dropped, keptOn, NO_VERDICTS, variantOf, variantRows, varietyOf } from "../src/part/store";

describe("a state's patch over a part's props", () => {
  const props = {
    suggestion: { state: "open", by: { name: "Lea" } },
    since: false,
    tags: ["a", "b"],
    onAccept: () => "accept",
  };

  it("merges plain objects and keeps the rest of the props", () => {
    const patched = merge(props, { suggestion: { state: "accepted" } });
    expect(patched.suggestion).toEqual({ state: "accepted", by: { name: "Lea" } });
    expect(patched.since).toBe(false);
    expect(props.suggestion.state).toBe("open");
  });

  it("puts arrays, functions and plain values in place of the props'", () => {
    const onAccept = () => "other";
    const patched = merge(props, { tags: ["c"], since: true, onAccept });
    expect(patched).toMatchObject({ tags: ["c"], since: true });
    expect(patched.onAccept).toBe(onAccept);
  });

  it("gives the props as they are without a patch", () => {
    expect(merge(props, undefined)).toBe(props);
  });
});

describe("the variant a part shows", () => {
  const labels = ["Card", "Tracked", "Marked"];
  const none = { kept: [], dropped: [] };

  it("shows the one shown last, or the first", () => {
    expect(variantOf(labels, { variant: "Tracked", state: undefined }, none)).toBe("Tracked");
    expect(variantOf(labels, { variant: undefined, state: undefined }, none)).toBe("Card");
    expect(variantOf(labels, { variant: "Gone", state: undefined }, none)).toBe("Card");
  });

  it("shows the first one left once the reviewer deleted the one shown", () => {
    const verdicts = { kept: [], dropped: ["Card", "Tracked"] };
    expect(variantOf(labels, { variant: "Tracked", state: undefined }, verdicts)).toBe("Marked");
  });

  it("keeps one variant on a settle, and a deleted one out of the kept", () => {
    const kept = keptOn({ kept: ["Tracked"], dropped: ["Card"] }, "Card");
    expect(kept).toEqual({ kept: ["Card"], dropped: [] });
    expect(dropped(kept, "Card")).toEqual({ kept: [], dropped: ["Card"] });
  });
});

describe("what a part has to lift", () => {
  const part = (labels: readonly string[], states: readonly string[] = []) => ({
    id: "p",
    name: "Card",
    labels,
    states,
    node: () => null,
  });

  it("counts the variants left and the states", () => {
    expect(varietyOf(part(["A", "B", "C"], ["Long"]), { kept: [], dropped: ["B"] })).toEqual({
      variants: 2,
      states: 1,
    });
    expect(varietyOf(part(["A"], ["Long"]), NO_VERDICTS)).toEqual({ variants: 1, states: 1 });
  });

  it("has nothing to lift with one variant left and no states", () => {
    expect(varietyOf(part(["A"]), NO_VERDICTS)).toBeUndefined();
    expect(varietyOf(part(["A", "B"]), { kept: [], dropped: ["B"] })).toBeUndefined();
  });
});

describe("the variant rows in the panel", () => {
  const part = { labels: ["Title first", "Status first", "Compact row"] };
  const none = { labels: [], at: 0 };

  it("lists the part's variants, with the one the page shows", () => {
    const shown = { variant: "Status first", state: undefined };
    expect(variantRows(part, shown, NO_VERDICTS, none)).toEqual({
      labels: ["Title first", "Status first", "Compact row"],
      at: 1,
      from: "part",
    });
  });

  it("leaves out a deleted variant, and shows the first one left when it was shown", () => {
    const shown = { variant: "Title first", state: undefined };
    const verdicts = dropped(NO_VERDICTS, "Title first");
    expect(variantRows(part, shown, verdicts, none)).toEqual({
      labels: ["Status first", "Compact row"],
      at: 0,
      from: "part",
    });
  });

  it("lists the step's own variants when its part has one left, and none when the step has one", () => {
    const one = { variant: undefined, state: undefined };
    const left = dropped(dropped(NO_VERDICTS, "Title first"), "Status first");
    const own = { labels: ["Empty", "Full"], at: 1 };
    expect(variantRows(part, one, left, own)).toEqual({ ...own, from: "own" });
    expect(variantRows(undefined, one, NO_VERDICTS, own)).toEqual({ ...own, from: "own" });
    expect(variantRows(undefined, one, NO_VERDICTS, { labels: ["Only"], at: 0 })).toBeUndefined();
    expect(variantRows(part, one, left, none)).toBeUndefined();
  });
});
