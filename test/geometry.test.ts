import { describe, expect, it } from "vitest";
import { inside, placeCard } from "../src/ui/geometry";

const screen = { width: 1000, height: 800 };
const field = { x: 300, y: 300, width: 400, height: 100 };
const covers = (p: { left: number; top: number }, card: { width: number; height: number }) =>
  p.left < field.x + field.width &&
  p.left + card.width > field.x &&
  p.top < field.y + field.height &&
  p.top + card.height > field.y;

describe("a card beside the part", () => {
  it("goes above the part when it fits there", () => {
    expect(placeCard(field, { width: 320, height: 200 }, screen)).toMatchObject({ side: "above" });
  });

  it("goes to a side where it covers nothing when it grows too tall for above", () => {
    const card = { width: 320, height: 330 };
    const place = placeCard(field, card, screen, "above", "above");
    expect(place.side).not.toBe("above");
    expect(covers(place, card)).toBe(false);
  });

  it("stays on its side while it still fits there", () => {
    const card = { width: 260, height: 200 };
    expect(placeCard(field, card, screen, "above", "left")).toMatchObject({ side: "left" });
  });

  it("covers the least it can when it fits nowhere", () => {
    const wide = { x: 0, y: 0, width: 1000, height: 740 };
    const place = placeCard(wide, { width: 320, height: 300 }, screen);
    expect(place.top + 300).toBeLessThanOrEqual(740);
  });

  it("keeps a dragged card inside the screen", () => {
    expect(inside({ left: -50, top: 900 }, { width: 320, height: 200 }, screen)).toEqual({
      left: 12,
      top: 540,
    });
  });
});
