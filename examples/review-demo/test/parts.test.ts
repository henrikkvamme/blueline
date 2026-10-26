import { mount, part, type DevAdapter } from "@henrikkvamme/blueline";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { parts } from "../../../src/part/store";

/*
 * Parts without React (part/part.ts), on a page with no React and no Tailwind: a part drawn
 * by the app's own code, and one in plain HTML. The overlay comes from the main entry, from
 * the source or from the built package; the store is shared between the two copies.
 */

const group = { id: "g", title: "G" };
const adapter: DevAdapter<void> = {
  journeys: [
    {
      id: "parts",
      title: "Parts",
      steps: [
        { id: "rows", title: "The rows", group, look: "", target: ["#rows"], part: "Rows" },
        { id: "header", title: "The header", group, look: "", target: ["#header"], part: "Header" },
      ],
    },
  ],
  context: () => undefined,
  enter: () => undefined,
};

const PAGE = `
  <div id="rows"><div data-blueline-part="Rows" data-source="alpha">alpha</div></div>
  <div id="other"><div data-blueline-part="Rows" data-source="beta">beta</div></div>
  <div id="header">
    <div data-blueline-part="Header" data-blueline-variant="Big">
      <h1>Big</h1>
      <template data-blueline-state="Empty"><h1>Big empty</h1></template>
      <template data-blueline-variant="Small"><h2>Small</h2></template>
    </div>
  </div>`;

const words = () =>
  (document.querySelector("blueline-tools")?.shadowRoot?.textContent ?? "").replace(/\s+/g, " ");
const liftHost = () => document.querySelector("blueline-lift");
/** What each copy in the lift shows, by its slot. */
const copies = () =>
  Object.fromEntries(
    [...(liftHost()?.querySelectorAll(":scope > [slot]") ?? [])].map((c) => [
      c.getAttribute("slot"),
      (c.textContent ?? "").trim(),
    ]),
  );
const instances = (name: string) => parts.current().instances.filter((i) => i.name === name);

describe("parts without React", () => {
  const page = document.createElement("main");
  const drawn: string[] = [];
  let undone = 0;
  const rows = part("Rows", {
    variants: ["Table", "Cards"],
    states: ["Empty"],
    show: (into, { variant, state, source }) => {
      const text = `${source.getAttribute("data-source") ?? "?"} ${variant} ${state ?? "as it is"}`;
      drawn.push(text);
      const p = document.createElement("p");
      p.textContent = text;
      // A copy may hold a marked part of its own: it is the lift's, not the page's.
      if (variant === "Cards") p.setAttribute("data-blueline-part", "Rows");
      into.append(p);
      return () => {
        undone += 1;
      };
    },
  });
  const heard = vi.fn();
  rows.subscribe(heard);

  beforeAll(async () => {
    localStorage.clear();
    page.innerHTML = PAGE;
    document.body.append(page);
    mount({ adapter, storageKey: "parts.review" });
    await vi.waitFor(() => expect(instances("Rows")).toHaveLength(2));
  });

  afterAll(() => {
    window.blueline?.dispose();
    rows.dispose();
    page.remove();
  });

  async function lift(step: string, title: string) {
    expect(window.blueline?.start("parts", step)).toBe(true);
    await expect.poll(words).toContain(title);
    await userEvent.keyboard("v");
    await expect.poll(liftHost).not.toBeNull();
  }

  it("draws the lifted part's copies from its own element, on both lines", async () => {
    await lift("rows", "The rows");
    await expect.poll(copies).toEqual({
      "variant:Table": "alpha Table as it is",
      "variant:Cards": "alpha Cards as it is",
      "state:0": "alpha Table as it is",
      "state:1": "alpha Table Empty",
    });
    await userEvent.keyboard("l");
    await expect.poll(copies).toMatchObject({
      "state:0": "alpha Cards as it is",
      "state:1": "alpha Cards Empty",
    });
    await userEvent.keyboard("j");
    await expect.poll(copies).toMatchObject({
      "variant:Table": "alpha Table Empty",
      "variant:Cards": "alpha Cards Empty",
    });
    // The marked part in the Cards copies is not one of the page's.
    expect(instances("Rows")).toHaveLength(2);
    await userEvent.keyboard("{Enter}");
    await expect.poll(liftHost).toBeNull();
    expect(rows.shown()).toEqual({ variant: "Cards", state: "Empty" });
    expect(heard).toHaveBeenCalled();
    // Each copy's cleanup ran once it went.
    expect(undone).toBe(drawn.length);
  });

  it("draws a part in plain HTML from its templates, on the page and in the lift", async () => {
    const element = page.querySelector("[data-blueline-part=Header]");
    const own = element?.querySelector("h1");
    await lift("header", "The header");
    await expect.poll(copies).toEqual({
      "variant:Big": "Big",
      "variant:Small": "Small",
      "state:0": "Big",
      "state:1": "Big empty",
    });
    await userEvent.keyboard("l");
    // Small has no template for Empty: it shows as it is.
    await expect.poll(copies).toMatchObject({ "state:1": "Small" });
    await userEvent.keyboard("{Enter}");
    await expect.poll(liftHost).toBeNull();
    await expect.poll(() => element?.querySelector("h2")?.textContent).toBe("Small");
    expect(own?.isConnected).toBe(false);
    // Back on the first variant, the page's own content comes back, the same nodes.
    await lift("header", "The header");
    await userEvent.keyboard("h{Enter}");
    await expect.poll(() => element?.querySelector("h1")).toBe(own);
    expect(element?.querySelector("h2")).toBeNull();
  });

  it("keeps a moved element's instance, and ends a removed one's", async () => {
    const before = instances("Rows").map((i) => i.id);
    const alpha = page.querySelector("[data-source=alpha]");
    if (alpha === null) throw new Error("No alpha part");
    page.querySelector("#other")?.append(alpha);
    await new Promise((done) => setTimeout(done, 50));
    expect(instances("Rows").map((i) => i.id)).toEqual(before);
    page.querySelector("[data-source=beta]")?.remove();
    await expect.poll(() => instances("Rows")).toHaveLength(1);
  });

  it("is found by the observer of another copy of the module", async () => {
    const copy: typeof import("../../../src/part/part") = await import(
      /* @vite-ignore */ `${new URL("../../../src/part/part.ts", import.meta.url).pathname}?copy`
    );
    const other = copy.part("Other", { variants: ["One", "Two"], show: () => undefined });
    const element = document.createElement("div");
    element.setAttribute("data-blueline-part", "Other");
    page.append(element);
    await expect.poll(() => instances("Other")).toHaveLength(1);
    other.dispose();
    expect(instances("Other")).toHaveLength(0);
  });
});
