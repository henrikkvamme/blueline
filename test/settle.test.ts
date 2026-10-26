import { describe, expect, it } from "vitest";
import { release, settleGate, settleWords } from "../src/ui/settle";

describe("a settle", () => {
  it("goes on at once, and does nothing more until the next step shows with its light in place", () => {
    const gate = settleGate();
    expect(gate.free()).toBe(true);
    // The session settled the step shown, 1-2, and the walk went on.
    gate.sent("1-2", "status");
    expect(gate.current()).toEqual({ kind: "going", from: "1-2", step: "status" });
    // A second y, Enter or check in the burst does nothing.
    expect(gate.free()).toBe(false);
    // The step settled still shows: the light has not left it yet.
    gate.shown("1-2");
    expect(gate.free()).toBe(false);
    gate.shown("1-3");
    expect(gate.current()).toEqual({ kind: "still" });
    expect(gate.free()).toBe(true);
  });

  it("names no part to show the settle when the tree settled another step", () => {
    const gate = settleGate();
    gate.sent("1-2", undefined);
    expect(gate.current()).toEqual({ kind: "going", from: "1-2", step: undefined });
    expect(gate.free()).toBe(false);
  });

  it("starts again at once when the walk stops or stays", () => {
    const gate = settleGate();
    gate.sent("1-2", "status");
    gate.reset();
    expect(gate.free()).toBe(true);
  });

  it("tells the light the old look of a step that undo took back, until it turns", () => {
    const gate = settleGate();
    let told = 0;
    gate.subscribe(() => (told += 1));
    gate.turn({ step: "status", settled: true });
    expect(gate.turning()).toEqual({ step: "status", settled: true });
    // Another step's light has nothing to turn.
    gate.turned("amount");
    expect(gate.turning()).toEqual({ step: "status", settled: true });
    gate.turned("status");
    expect(gate.turning()).toBeUndefined();
    expect(told).toBe(2);
  });

  it("finishes only with an Enter pressed after the finish shows", () => {
    const enter = release();
    // The Enter that settled the last step is still down as the finish shows.
    enter.down();
    enter.shows();
    expect(enter.free()).toBe(false);
    enter.up();
    expect(enter.free()).toBe(true);
    // A quick press is up before the finish shows.
    const quick = release();
    quick.down();
    quick.up();
    quick.shows();
    expect(quick.free()).toBe(true);
  });
});

describe("the words on Settle", () => {
  it("name the variant the page shows on a step that lists variants", () => {
    expect(settleWords(false, "Cards", undefined)).toEqual({
      text: "Keep Cards",
      label: "Settle the step and keep Cards",
    });
    expect(settleWords(false, "Table", undefined).text).toBe("Keep Table");
  });

  it("say Settle on a step with no variants", () => {
    expect(settleWords(false, undefined, undefined).text).toBe("Settle");
  });

  it("name the variant kept once settled, else say Settled", () => {
    expect(settleWords(true, "Table", "Cards")).toEqual({
      text: "Kept Cards",
      label: "Settled, kept Cards: open the step again",
    });
    expect(settleWords(true, undefined, undefined).text).toBe("Settled");
  });
});
