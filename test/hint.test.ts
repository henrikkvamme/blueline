import { describe, expect, it } from "vitest";
import { hintShows } from "../src/ui/hint";

const bare = { journeys: 0, parts: 0, messages: 0, notes: 0 };

describe("the empty page's hint", () => {
  it("shows on a page with no journey, no part and an empty chat", () => {
    expect(hintShows(bare)).toBe(true);
  });

  it("does not show where the tree has a journey or the page a part", () => {
    expect(hintShows({ ...bare, journeys: 1 })).toBe(false);
    expect(hintShows({ ...bare, parts: 2 })).toBe(false);
  });

  it("goes once the chat has a message or a note waits", () => {
    expect(hintShows({ ...bare, messages: 1 })).toBe(false);
    expect(hintShows({ ...bare, notes: 1 })).toBe(false);
  });
});
