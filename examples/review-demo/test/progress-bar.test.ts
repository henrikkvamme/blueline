import { mount, type DevAdapter } from "@henrikkvamme/blueline";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

/*
 * The bar of a journey past ten steps, in the panel: each run of settled steps in green at
 * its place, with a gap for each step not settled.
 */

const group = { id: "g", title: "G" };
const steps = Array.from({ length: 11 }, (_, i) => ({
  id: `s${String(i)}`,
  title: `Step ${String(i + 1)}`,
  group,
  look: "",
}));
const adapter: DevAdapter<void> = {
  journeys: [{ id: "long", title: "Long", steps }],
  context: () => undefined,
  enter: () => undefined,
};

const tools = () => document.querySelector("blueline-tools")?.shadowRoot ?? null;
const words = () => (tools()?.textContent ?? "").replace(/\s+/g, " ");
/** The bar's count, as it reads aloud. */
const settled = () =>
  tools()?.querySelector("[aria-label$='steps settled']")?.getAttribute("aria-label") ?? "";
/** The bar's green runs, as the shares of the bar they start at and fill. */
function runs() {
  const bar = tools()?.querySelector("[aria-label$='steps settled'] > span");
  if (!bar) return [];
  const width = bar.getBoundingClientRect().width;
  const left = bar.getBoundingClientRect().left;
  return [...bar.querySelectorAll<HTMLElement>("i.bg-dt-good")].map((run) => {
    const box = run.getBoundingClientRect();
    return {
      from: Math.round(((box.left - left) / width) * 11),
      width: Math.round((box.width / width) * 11),
    };
  });
}

/** The steps settled before the panel mounts, as a review kept them. */
const DONE = [0, 1, 2, 3, 5, 6, 7, 8, 10];

describe("the bar of a long journey", () => {
  beforeAll(async () => {
    localStorage.clear();
    const feedback = Object.fromEntries(DONE.map((i) => [`s${String(i)}`, { settled: true }]));
    const kept = { journey: "long", active: true, at: 4, feedback, panel: true };
    localStorage.setItem("progress-bar.review", JSON.stringify(kept));
    mount({ adapter, storageKey: "progress-bar.review" });
    await vi.waitFor(() => expect(window.blueline).toBeDefined(), { timeout: 5000 });
  });

  afterAll(() => window.blueline?.dispose());

  it("shows each run of settled steps at its place, with a gap for each step not settled", async () => {
    await expect.poll(settled).toBe("9 of 11 steps settled");
    await expect.poll(words).toContain("5 of 11");
    await expect.poll(runs).toEqual([
      { from: 0, width: 4 },
      { from: 5, width: 4 },
      { from: 10, width: 1 },
    ]);
    const bar = tools()?.querySelector<HTMLElement>("[aria-label$='steps settled']");
    if (bar) await page.screenshot({ element: bar, path: "progress-bar.png" });
  });
});
