import { afterEach, describe, expect, it } from "vitest";
import { showStill, stillOf } from "../../../src/part/still";

/*
 * The still copy of a step's target (part/still.ts), on a page with no React: it keeps the
 * look the page had once the page's CSS changes, the page's queries and CSS do not reach it,
 * and a long page costs what shows.
 */

let style: HTMLStyleElement | undefined;
afterEach(() => {
  document.body.replaceChildren();
  document.body.className = "";
  style?.remove();
  style = undefined;
});

const css = (text: string) => {
  style = document.createElement("style");
  style.textContent = text;
  document.head.append(style);
};

const page = (html: string) => {
  const at = document.createElement("main");
  at.innerHTML = html;
  document.body.append(at);
  return at;
};

/** Shows the still in a holder on the page, as the lift does. */
const shown = (targets: readonly Element[], holder = document.createElement("div")) => {
  const still = stillOf(targets);
  if (still === undefined) throw new Error("Too big to copy");
  if (!holder.isConnected) document.body.append(holder);
  return { still, copy: showStill(still, holder) };
};

const colorOf = (el: Element | null | undefined, property = "color") =>
  el === null || el === undefined ? "" : getComputedStyle(el).getPropertyValue(property);

describe("a still copy", () => {
  it("keeps the look the variant had, once the page shows another", () => {
    css(`
      .card { width: 200px; padding: 8px; color: rgb(0, 0, 0); }
      body.cards .card { color: rgb(200, 0, 0); border: 2px solid rgb(0, 0, 200); }
      .card::before { content: "→ "; font-weight: 700; }
      body:not(.cards) span { color: rgb(0, 160, 0) !important; }
    `);
    const at = page('<div id="target" class="card"><span id="name">Ada</span></div>');
    document.body.classList.add("cards");
    const { still, copy } = shown([at.querySelector("#target") ?? at]);
    document.body.classList.remove("cards");
    const name = [...(copy?.querySelectorAll("span") ?? [])].find((s) => s.textContent === "Ada");
    expect(name).toBeDefined();
    // The copy's card is red with a blue border, as the variant drew it.
    const card = name?.parentElement;
    expect(card === null || card === undefined ? "" : getComputedStyle(card).color).toBe(
      "rgb(200, 0, 0)",
    );
    expect(card === null || card === undefined ? "" : getComputedStyle(card).borderTopColor).toBe(
      "rgb(0, 0, 200)",
    );
    // The ::before is a span with its words and weight.
    const before = card?.firstElementChild;
    expect(before?.textContent).toBe("→ ");
    expect(before === null || before === undefined ? "" : getComputedStyle(before).fontWeight).toBe(
      "700",
    );
    // 200 wide, with 8 px of padding and 2 px of border on each side.
    expect(still.width).toBe(220);
    // The page's rules, important ones too, do not reach the copy, and its ::before is
    // not drawn twice.
    expect(colorOf(name)).toBe("rgb(200, 0, 0)");
    expect(card?.querySelectorAll("span")).toHaveLength(2);
    // The page's queries find the page's own elements only.
    expect(document.querySelectorAll("#target, #name, .card, span")).toHaveLength(2);
    expect(copy?.querySelector("[class]")).toBeNull();
  });

  it("keeps a field's value and check, and puts no field in the page's forms", () => {
    const at = page(
      '<form><input id="q" name="q" /><input id="c" type="checkbox" name="c" /><select id="s" name="s"><option>A</option><option>B</option></select><textarea id="t"></textarea></form>',
    );
    const q = at.querySelector<HTMLInputElement>("#q");
    const c = at.querySelector<HTMLInputElement>("#c");
    const s = at.querySelector<HTMLSelectElement>("#s");
    const t = at.querySelector<HTMLTextAreaElement>("#t");
    if (q === null || c === null || s === null || t === null) throw new Error("No fields");
    q.value = "Ada";
    c.checked = true;
    s.value = "B";
    t.value = "Notes";
    const { copy } = shown([at.querySelector("form") ?? at]);
    expect(copy?.querySelector<HTMLInputElement>("input:not([type])")?.value).toBe("Ada");
    expect(copy?.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
    expect(copy?.querySelector("select")?.value).toBe("B");
    expect(copy?.querySelector("textarea")?.value).toBe("Notes");
    expect(copy?.querySelector("[name]")).toBeNull();
  });

  it("copies an open shadow root and the nodes its slots show", () => {
    const at = page('<div id="host"><b>slotted</b></div>');
    const host = at.querySelector("#host");
    const root = host?.attachShadow({ mode: "open" });
    if (root === undefined) throw new Error("No shadow root");
    root.innerHTML = "<style>i { color: rgb(0, 128, 0); }</style><i>inside</i> <slot></slot>";
    const { copy } = shown([host ?? at]);
    const inside = copy?.querySelector("i");
    expect(inside?.textContent).toBe("inside");
    expect(inside === null || inside === undefined ? "" : getComputedStyle(inside).color).toBe(
      "rgb(0, 128, 0)",
    );
    expect(copy?.querySelector("b")?.textContent).toBe("slotted");
    expect(copy?.querySelector("style")).toBeNull();
  });

  it("keeps a fixed child at its place, cut to the box, on the background the page paints", () => {
    css("body { background: rgb(10, 10, 10); }");
    const at = page(
      '<div id="target" style="margin: 40px; width: 100px; height: 50px; color: white">Dark<div style="transform: translateX(5px)"><p id="pinned" style="position: fixed; left: 10px; top: 10px; margin: 0">Pinned</p></div></div>',
    );
    const target = at.querySelector("#target");
    const pinned = at.querySelector("#pinned");
    if (target === null || pinned === null) throw new Error("No target");
    const { copy } = shown([target]);
    if (copy === undefined) throw new Error("No copy");
    expect(colorOf(copy, "background-color")).toBe("rgb(10, 10, 10)");
    expect(colorOf(copy, "overflow")).toBe("hidden");
    const kept = copy.querySelector("#pinned");
    const box = copy.getBoundingClientRect();
    const rect = kept?.getBoundingClientRect();
    const was = pinned.getBoundingClientRect();
    const from = target.getBoundingClientRect();
    // As far from the box's corner as it was from the target's, though its parent in the
    // copy is its containing block.
    expect([rect?.left, rect?.top].map((n) => Math.round(n ?? 0))).toEqual([
      Math.round(box.left + was.left - from.left),
      Math.round(box.top + was.top - from.top),
    ]);
  });

  it("keeps a fixed child at its place in a scaled parent", () => {
    const at = page(
      '<div id="target" style="width: 120px; height: 120px"><div style="transform: scale(2); transform-origin: 0 0; width: 40px; height: 40px"><p id="pinned" style="position: fixed; left: 10px; top: 10px; margin: 0">x</p></div></div>',
    );
    const target = at.querySelector("#target");
    const pinned = at.querySelector("#pinned");
    if (target === null || pinned === null) throw new Error("No target");
    const { copy } = shown([target]);
    const kept = copy?.querySelector("#pinned")?.getBoundingClientRect();
    const box = copy?.getBoundingClientRect();
    const was = pinned.getBoundingClientRect();
    const from = target.getBoundingClientRect();
    expect(
      [(kept?.left ?? 0) - (box?.left ?? 0), (kept?.top ?? 0) - (box?.top ?? 0)].map(Math.round),
    ).toEqual([was.left - from.left, was.top - from.top].map(Math.round));
  });

  it("keeps the size of an inline element out of the box, so a scrolled line stays put", () => {
    const at = page(
      '<div id="target" style="width: 200px; overflow-x: auto; white-space: nowrap"><span>Far to the left, out of sight</span> <b id="seen">Seen</b> and more words after it, to scroll</div>',
    );
    const target = at.querySelector("#target");
    const seen = at.querySelector("#seen");
    if (target === null || seen === null) throw new Error("No target");
    target.scrollLeft = 180;
    const { copy } = shown([target]);
    const list = copy?.firstElementChild;
    expect(list?.scrollLeft).toBe(target.scrollLeft);
    const kept = copy?.querySelector("#seen")?.getBoundingClientRect();
    const box = copy?.getBoundingClientRect();
    expect(Math.round((kept?.left ?? 0) - (box?.left ?? 0))).toBe(
      Math.round(seen.getBoundingClientRect().left - target.getBoundingClientRect().left),
    );
  });

  it("keeps an SVG's own gradient and symbol, once the page's go", () => {
    const at = page(`
      <svg id="target" width="40" height="20">
        <defs><linearGradient id="fade"><stop offset="0" stop-color="rgb(255, 0, 0)" /></linearGradient>
        <symbol id="dot"><circle cx="5" cy="5" r="5" /></symbol></defs>
        <rect width="20" height="20" fill="url(#fade)" /><use href="#dot" x="25" />
      </svg>`);
    const target = at.querySelector("#target");
    if (target === null) throw new Error("No target");
    const { copy } = shown([target]);
    at.remove();
    expect(copy?.querySelector("linearGradient#fade")).not.toBeNull();
    const use = copy?.querySelector("use");
    expect(use?.getAttribute("href")).toBe("#dot");
    expect(use?.getRootNode()).toBe(copy?.querySelector("symbol#dot")?.getRootNode());
  });

  it("copies what shows of a long page in bounded time, and says when it is too big", () => {
    const rows = Array.from(
      { length: 5000 },
      (_, i) => `<p style="margin: 0">Row ${String(i)}</p>`,
    );
    const at = page(
      `<div id="target" style="height: 200px; overflow: hidden">${rows.join("")}</div>`,
    );
    const target = at.querySelector("#target");
    if (target === null) throw new Error("No target");
    const started = performance.now();
    const { copy } = shown([target]);
    expect(performance.now() - started).toBeLessThan(2000);
    // The rows out of the box keep their size and hold nothing.
    expect(copy?.textContent).toContain("Row 0");
    expect(copy?.textContent).not.toContain("Row 4999");
    expect(copy?.querySelectorAll("p")).toHaveLength(5000);
    // Past the most elements it copies, it copies none.
    expect(stillOf([target], { most: 100 })).toBeUndefined();
  });

  it("copies the targets at their places in one box", () => {
    const at = page(
      '<div id="a" style="position: absolute; left: 10px; top: 20px; width: 30px; height: 10px"></div><div id="b" style="position: absolute; left: 60px; top: 40px; width: 20px; height: 20px"></div>',
    );
    const { still } = shown([at.querySelector("#a") ?? at, at.querySelector("#b") ?? at]);
    expect([still.width, still.height]).toEqual([70, 40]);
  });

  it("puts a scrolled element back where it was scrolled", () => {
    const at = page(
      '<div id="list" style="height: 40px; overflow: auto"><div style="height: 400px">Long</div></div>',
    );
    const list = at.querySelector("#list");
    list?.scrollTo(0, 120);
    const { copy } = shown([list ?? at]);
    expect(copy?.firstElementChild?.scrollTop).toBe(120);
  });
});
