import { mount, type DevAdapter } from "@henrikkvamme/blueline";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

/*
 * Pointing at a part inside an open dialog. A dialog of Base UI or Radix closes on a press
 * outside its popup, which it hears on the document in the capture phase; the crosshair is
 * the tools' own and lies outside the popup, so the tools keep the press from the page.
 */

const adapter: DevAdapter<void> = {
  journeys: [],
  context: () => undefined,
  enter: () => undefined,
};

const tools = () => document.querySelector("blueline-tools")?.shadowRoot ?? null;
const words = () => (tools()?.textContent ?? "").replace(/\s+/g, " ");

describe("pointing in an open dialog", () => {
  const dialog = document.createElement("div");
  let closed = false;
  /** Base UI's outside press: any press on the document whose path misses the popup. */
  const outside = (e: Event) => {
    if (!e.composedPath().includes(dialog)) closed = true;
  };
  const presses = ["pointerdown", "mousedown", "pointerup", "click"] as const;

  beforeAll(async () => {
    localStorage.clear();
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = `<menu><li><button id="item">Make a delegate</button></li></menu>`;
    dialog.style.cssText = "position: fixed; top: 40px; left: 40px; padding: 20px";
    document.body.append(dialog);
    for (const type of presses) document.addEventListener(type, outside, true);
    mount({ adapter, storageKey: "point-in-dialog.review" });
    await vi.waitFor(() => expect(window.blueline).toBeDefined(), { timeout: 5000 });
  });

  afterAll(() => {
    for (const type of presses) document.removeEventListener(type, outside, true);
    window.blueline?.dispose();
    dialog.remove();
  });

  it("keeps the dialog open and points at the item under the click", async () => {
    const item = document.querySelector<HTMLElement>("#item");
    if (item === null) throw new Error("No item");
    await userEvent.hover(item);
    await userEvent.keyboard("{Alt>}");
    await expect.poll(() => tools()?.querySelector(".cursor-crosshair") ?? null).not.toBeNull();
    const box = item.getBoundingClientRect();
    const layer = tools()?.querySelector<HTMLElement>(".cursor-crosshair");
    if (!layer) throw new Error("No crosshair");
    await userEvent.click(layer, {
      position: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    });
    await userEvent.keyboard("{/Alt}");
    expect(closed).toBe(false);
    await expect.poll(words).toContain("Make a delegate");
  });
});
