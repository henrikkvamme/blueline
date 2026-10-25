import { describe, expect, it } from "vitest";
import { settleGate } from "../src/ui/settle";

describe("a settle", () => {
  it("does nothing while another settle's motion plays", () => {
    const gate = settleGate();
    expect(gate.begin("status")).toBe(true);
    expect(gate.current()).toEqual({ kind: "playing", step: "status" });
    // A second y, Enter or check during the motion, on the same step or another.
    expect(gate.begin("status")).toBe(false);
    expect(gate.begin("amount")).toBe(false);
  });

  it("does nothing until the next step shows, with its light in place", () => {
    const gate = settleGate();
    gate.begin("status");
    gate.sent("1-2");
    expect(gate.begin("amount")).toBe(false);
    // The step settled still shows: the walk has not gone on yet.
    gate.shown("1-2");
    expect(gate.begin("amount")).toBe(false);
    gate.shown("1-3");
    expect(gate.current()).toEqual({ kind: "still" });
    expect(gate.begin("amount")).toBe(true);
  });

  it("starts again at once when the walk stops or stays", () => {
    const gate = settleGate();
    gate.begin("status");
    gate.sent("1-2");
    gate.reset();
    expect(gate.begin("status")).toBe(true);
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
});
