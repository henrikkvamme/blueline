import { describe, expect, it } from "vitest";
import { slashMatches } from "../src/notes/slash";

describe("the composer's slash commands", () => {
  it("lists every command for a lone slash, and those a start names", () => {
    expect(slashMatches("/").map((c) => c.name)).toEqual(["clear", "settle"]);
    expect(slashMatches("/se").map((c) => c.name)).toEqual(["settle"]);
    expect(slashMatches(" /clear ").map((c) => c.name)).toEqual(["clear"]);
  });

  it("lists none for words, or for a command no one has", () => {
    expect(slashMatches("")).toEqual([]);
    expect(slashMatches("/clear the list")).toEqual([]);
    expect(slashMatches("Make it /clear")).toEqual([]);
    expect(slashMatches("/archive")).toEqual([]);
  });
});
