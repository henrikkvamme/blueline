import { describe, expect, it } from "vitest";
import { inside, lineShift, liftRoom, placeCard } from "../src/ui/geometry";

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

describe("the lift's room", () => {
  it("stands beside the docked panel, so a variant at the side does not go under it", () => {
    const room = liftRoom(1440, 360);
    expect(room).toBe(1080);
    // Three variants, the middle one shown: it stands at the middle of the page's room.
    const widths = [300, 400, 300];
    const shift = lineShift(widths, 1, room, 40);
    expect(shift + 300 + 40 + 400 / 2).toBe(540);
    // The last variant shown ends inside the room, short of the panel's edge.
    const last = lineShift(widths, 2, room, 40);
    expect(last + 300 + 40 + 400 + 40 + 300).toBeLessThanOrEqual(room);
  });

  it("takes the whole window with no panel docked, as on a phone or with the panel hidden", () => {
    expect(liftRoom(1440, 0)).toBe(1440);
    expect(liftRoom(390, 0)).toBe(390);
    // A panel as wide as the window leaves no room: the lift keeps the window.
    expect(liftRoom(300, 360)).toBe(300);
  });
});
