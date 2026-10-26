import { describe, expect, it } from "vitest";
import { menuMove, menuNext, menuTakes } from "../src/ui/menu-keys";

describe("the keys of a ⋯ menu", () => {
  it("moves down with j and Down, and up with k and Up", () => {
    expect(menuMove("j")).toBe(1);
    expect(menuMove("ArrowDown")).toBe(1);
    expect(menuMove("k")).toBe(-1);
    expect(menuMove("ArrowUp")).toBe(-1);
    expect(menuMove("d")).toBe(0);
  });

  it("goes round from the last item to the first, and back", () => {
    expect(menuNext(3, 1, 4)).toBe(0);
    expect(menuNext(0, -1, 4)).toBe(3);
    expect(menuNext(1, 1, 4)).toBe(2);
  });

  it("starts at the first item going down and the last going up", () => {
    expect(menuNext(-1, 1, 4)).toBe(0);
    expect(menuNext(-1, -1, 4)).toBe(3);
    expect(menuNext(-1, 1, 0)).toBe(-1);
  });

  it("takes its moves, Escape, Tab, Enter and Space, and leaves the host's keys", () => {
    for (const key of ["j", "k", "ArrowDown", "ArrowUp", "Escape", "Tab", "Enter", " "])
      expect(menuTakes(key)).toBe(true);
    for (const key of ["d", "z", "u", "v", "h", "l", "i", "R"]) expect(menuTakes(key)).toBe(false);
  });
});
