import { describe, expect, it } from "vitest";
import { merge } from "../src/part/merge";
import { dropped, keptOn, NO_VERDICTS, variantOf, varietyOf } from "../src/part/store";

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
