import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { App } from "../src/app";

/*
 * The demo as a reviewer uses it, in Chromium: the app as it runs, with Blueline mounted by
 * its dev module (src/dev/review.ts), from the source or from the built package
 * (vite.config.ts, the browser projects). The checks read the tools' shadow roots.
 */

const JOURNEY = "handle-request";

/** The tools' shadow root. */
const tools = () => document.querySelector("blueline-tools")?.shadowRoot ?? null;
/** The lift's shadow root, while a part is lifted. */
const lift = () => document.querySelector("blueline-lift")?.shadowRoot ?? null;
/** The tools' words, in one line. */
const words = () => (tools()?.textContent ?? "").replace(/\s+/g, " ");
/** The focused element, also in a shadow root. */
function focused(): Element | null {
  let at = document.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}
/** The step composer's field. */
const field = () =>
  tools()?.querySelector<HTMLTextAreaElement>("textarea[data-dt-composer=step]") ?? null;

describe("a review of the demo", () => {
  const address = location.href;
  const root = document.createElement("div");

  beforeAll(async () => {
    localStorage.clear();
    document.body.append(root);
    createRoot(root).render(<App />);
    await vi.waitFor(() => expect(window.blueline).toBeDefined(), { timeout: 5000 });
  });

  afterAll(() => {
    window.blueline?.dispose();
    root.remove();
    history.replaceState(null, "", address);
  });

  /** Starts the journey on its step, and waits until the step shows. */
  async function startOn(step: string, title: string) {
    expect(window.blueline?.start(JOURNEY, step)).toBe(true);
    await expect.poll(words, { timeout: 5000 }).toContain(title);
  }

  it("puts the tools in their own shadow root, with their own CSS", async () => {
    await startOn("list-rows", "The requests");
    expect(document.querySelectorAll("blueline-tools")).toHaveLength(1);
    expect(tools()?.adoptedStyleSheets.length).toBe(1);
    // The page has no Tailwind: the tools' colours are their own.
    const surface = tools()?.querySelector("[class*='bg-dt-panel']");
    expect(surface).not.toBeNull();
    if (surface) expect(getComputedStyle(surface).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("writes in the step's composer, and keeps the keys from the page", async () => {
    await startOn("list-rows", "The requests");
    await userEvent.keyboard("i");
    await expect.poll(focused).toBe(field());
    await userEvent.keyboard("lj v");
    expect(field()?.value).toBe("lj v");
    // The keys were the note's: the step did not change and nothing was lifted.
    expect(words()).toContain("The requests");
    expect(lift()).toBeNull();
    await userEvent.keyboard("{Escape}{Escape}");
    await expect.poll(focused).not.toBe(field());
  });

  it("walks the tree with keys and opens the step it selects", async () => {
    await startOn("list-rows", "The requests");
    await userEvent.keyboard("i");
    await expect.poll(focused).toBe(field());
    // Escape goes to vim's normal mode, and a second one to the tree.
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => focused()?.closest("nav[data-dt-zone=panel]") ?? null).not.toBeNull();
    await userEvent.keyboard("j{Enter}");
    await expect.poll(words).toContain("The status tabs");
  });

  it("opens the g menu and chooses in it by its key", async () => {
    await startOn("list-tabs", "The status tabs");
    await userEvent.keyboard("g");
    const menu = () => tools()?.querySelector("[aria-label='After g']") ?? null;
    await expect.poll(menu).not.toBeNull();
    // g g: the first open step.
    await userEvent.keyboard("g");
    await expect.poll(menu).toBeNull();
    await expect.poll(words).toContain("The requests");
  });

  it("lifts a part, goes through both lines, and puts a variant on the page", async () => {
    await startOn("list-rows", "The requests");
    await userEvent.keyboard("v");
    await expect.poll(lift, { timeout: 5000 }).not.toBeNull();
    const host = document.querySelector("blueline-lift");
    // Each option shows the part's copy through its slot.
    await expect
      .poll(() =>
        [...(lift()?.querySelectorAll("slot") ?? [])].map((s) => s.assignedElements().length),
      )
      .toEqual([1, 1, 1, 1, 1]);
    // The click targets and the dim have their size and colour on a page with no Tailwind.
    const use = lift()?.querySelector("button[aria-label^='Use']");
    expect(use?.getBoundingClientRect().width).toBeGreaterThan(0);
    // The option in the middle of each line is the one Enter uses.
    const middles = () =>
      [...(lift()?.querySelectorAll("button[aria-label^='Use ']") ?? [])].map((b) =>
        b.getAttribute("aria-label"),
      );
    /** The copy in a slot of the lift. */
    const copy = (slot: string) => host?.querySelector(`:scope > [slot="${slot}"]`) ?? null;
    await userEvent.keyboard("l");
    await expect.poll(middles).toContain("Use Cards");
    // The column shows Cards now, and the row each variant as it is.
    await expect.poll(() => copy("state:0")?.querySelector("ul") ?? null).not.toBeNull();
    expect(copy("variant:Table")?.querySelector("table")).not.toBeNull();
    await userEvent.keyboard("j");
    await expect.poll(middles).toContain("Use Empty");
    // The row shows each variant in the Empty state now.
    await expect.poll(() => copy("variant:Table")?.textContent).toContain("No requests here.");
    await userEvent.keyboard("k");
    await expect.poll(middles).toContain("Use As it is");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => host?.isConnected).toBe(false);
    // The page shows the cards now.
    const part = document.querySelector("[data-review=request-table]");
    await expect.poll(() => part?.querySelector("ul") ?? null).not.toBeNull();
    expect(part?.querySelector("table")).toBeNull();
  });
});
