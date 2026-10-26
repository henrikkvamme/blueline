import { describe, expect, it } from "vitest";
import type { Box } from "../src/ui/geometry";
import { lightFrame, PART_WAIT, type Frame, type Missing, type Motion } from "../src/ui/light";
import { settleGate } from "../src/ui/settle";

const PART: Box = { x: 10, y: 10, width: 100, height: 40 };

/** The light as Light draws it, frame by frame, with the settle gate it opens. */
function light() {
  let motion: Motion = { kind: "fading", at: "" };
  let missing: Missing | undefined;
  let drawn: Frame["drawn"];
  const placed: string[] = [];
  const gate = settleGate();
  const frame = (f: {
    readonly at: string;
    readonly now: number;
    readonly box?: Box;
    readonly page?: string;
    readonly left?: string;
  }) => {
    const page = f.page ?? "/";
    const next = lightFrame(motion, missing, {
      box: f.box,
      at: f.at,
      ready: true,
      left: f.left,
      now: f.now,
      page,
      reduced: () => false,
      drawn,
    });
    motion = next.motion;
    missing = next.missing;
    if (next.placed !== undefined) {
      placed.push(next.placed);
      gate.shown(next.placed);
    }
    // As Light's layout effect: the box it drew round a part that shows.
    if (f.box !== undefined && motion.at === f.at) drawn = { box: f.box, page };
  };
  /** Frames at 60 per second, from `from` ms to `to`. */
  const frames = (from: number, to: number, f: Omit<Parameters<typeof frame>[0], "now">) => {
    for (let now = from; now <= to; now += 16) frame({ ...f, now });
  };
  return { frames, placed, gate };
}

describe("the light", () => {
  it("stands on a step whose part does not show, after a step whose part did not show either", () => {
    const l = light();
    l.frames(0, 100, { at: "1-0", box: PART });
    expect(l.placed).toEqual(["1-0"]);
    // y on 1-0: the walk goes on to 1-1, whose part does not show.
    l.gate.sent("1-0", "a");
    l.frames(116, 1000, { at: "1-1", left: "1-0" });
    expect(l.placed).toEqual(["1-0", "1-1"]);
    expect(l.gate.free()).toBe(true);
    // y on 1-1: the walk goes on to 1-2, whose part does not show either. Its light stands in
    // place all the same, so the next y settles.
    l.gate.sent("1-1", "b");
    l.frames(1016, 2000, { at: "1-2", left: "1-1" });
    expect(l.placed).toEqual(["1-0", "1-1", "1-2"]);
    expect(l.gate.free()).toBe(true);
  });

  it("stands on a step on another page whose part does not show", () => {
    const l = light();
    l.frames(0, 100, { at: "1-0", box: PART, page: "/a" });
    l.gate.sent("1-0", "a");
    l.frames(116, 1500, { at: "1-1", left: "1-0", page: "/b" });
    expect(l.placed).toEqual(["1-0", "1-1"]);
    expect(l.gate.free()).toBe(true);
  });

  it("gives each step's part its own time to show, so a burst of y waits on each", () => {
    const l = light();
    l.frames(0, 100, { at: "1-0", box: PART });
    l.frames(116, 1000, { at: "1-1" });
    expect(l.placed).toEqual(["1-0", "1-1"]);
    l.gate.sent("1-1", "b");
    // The part of 1-1 was missing for long, but 1-2 has its own wait.
    l.frames(1016, 1000 + PART_WAIT - 16, { at: "1-2", left: "1-1" });
    expect(l.placed).toEqual(["1-0", "1-1"]);
    expect(l.gate.free()).toBe(false);
    l.frames(1000 + PART_WAIT, 1000 + PART_WAIT + 100, { at: "1-2", left: "1-1" });
    expect(l.placed).toEqual(["1-0", "1-1", "1-2"]);
  });

  it("glides to the next part after a settle, and stands there once the glide ends", () => {
    const l = light();
    l.frames(0, 100, { at: "1-0", box: PART });
    l.gate.sent("1-0", "a");
    l.frames(116, 200, { at: "1-1", left: "1-0", box: { ...PART, y: 300 } });
    expect(l.gate.free()).toBe(false);
    l.frames(216, 600, { at: "1-1", left: "1-0", box: { ...PART, y: 300 } });
    expect(l.placed).toEqual(["1-0", "1-1"]);
    expect(l.gate.free()).toBe(true);
  });
});
