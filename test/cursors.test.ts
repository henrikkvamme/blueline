import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cursorOf, keepCursor } from "../src/io/cursors";

/** The browser's storage, as a map. */
function stubStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  });
  return items;
}

describe("the fields' cursors", () => {
  beforeEach(() => void stubStorage());
  afterEach(() => void vi.unstubAllGlobals());

  it("give back where each field's cursor was", () => {
    keepCursor("composer:a", 4);
    keepCursor("composer:b", 9);
    keepCursor("composer:a", 2);
    expect(cursorOf("composer:a")).toBe(2);
    expect(cursorOf("composer:b")).toBe(9);
    expect(cursorOf("composer:c")).toBeUndefined();
  });

  it("keep the newest hundred, so the storage does not grow", () => {
    for (let i = 0; i < 120; i += 1) keepCursor(`composer:${i}`, i);
    expect(cursorOf("composer:19")).toBeUndefined();
    expect(cursorOf("composer:20")).toBe(20);
    expect(cursorOf("composer:119")).toBe(119);
  });

  it("read nothing from storage it cannot read", () => {
    localStorage.setItem("blueline.cursors", "{not json");
    expect(cursorOf("composer:a")).toBeUndefined();
  });
});
