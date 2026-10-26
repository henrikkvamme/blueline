import { afterEach, describe, expect, it, vi } from "vitest";

/** A fresh copy of the module, as a second bundle of Blueline loads its own. */
async function copy() {
  vi.resetModules();
  return import("../src/core/owner");
}

const overlay = () => ({ start: vi.fn(), yield: vi.fn() });

describe("the page's one overlay", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, Symbol.for("blueline.owner"));
  });

  it("goes to the newest claim from any copy, in either order", async () => {
    for (const order of [0, 1]) {
      Reflect.deleteProperty(globalThis, Symbol.for("blueline.owner"));
      const one = await copy();
      const two = await copy();
      const [first, second] = order === 0 ? [one, two] : [two, one];
      const older = overlay();
      const newer = overlay();
      first.claim(older);
      expect(older.yield).not.toHaveBeenCalled();
      second.claim(newer);
      expect(older.yield).toHaveBeenCalledOnce();
      expect(newer.yield).not.toHaveBeenCalled();
      expect(first.owner()).toBe(newer);
    }
  });

  it("is left by its release, but not by the release of one that yielded", async () => {
    const { claim, owner } = await copy();
    const older = overlay();
    const newer = overlay();
    const releaseOlder = claim(older);
    const releaseNewer = claim(newer);
    releaseOlder();
    expect(owner()).toBe(newer);
    releaseNewer();
    expect(owner()).toBeUndefined();
  });

  it("starts the review on the overlay that has the page", async () => {
    const { claim, owner } = await copy();
    const one = overlay();
    claim(one);
    owner()?.start("approve", 2, true);
    expect(one.start).toHaveBeenCalledWith("approve", 2, true);
  });
});
