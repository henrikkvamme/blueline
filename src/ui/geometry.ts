/*
 * Where things are on the page: the box of the part a step is about, where a card goes
 * beside it, and an element in words a reviewer would use. Plain DOM reads, no React.
 */

/** The dev tools' own elements, which pointing skips. */
export const UI = { "data-dt-ui": "" };

/** Marks the tools' bar and the sheets above it on a phone, which the page makes room for. */
export const DOCK = { ...UI, "data-dt-dock": "" };

/** A faint ring on the tools' part that has the keys, so the reviewer sees where they go. */
export const FOCUSED = "ring-1 ring-transparent focus-within:ring-dt-accent/80";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PAD = 8;
const EDGE = 12;
const GAP = 10;

/** The bottom of the screen the bar takes, which cards keep clear of. */
export const BAR = 60;

/** The panel's width, docked at the right: the page narrows by as much. */
export const PANEL = 360;

/** How wide the lift's room is: the page beside the docked panel, from the window's left
 * edge, so the variants at the sides stay in view. With no panel docked, as on a phone or with
 * the panel hidden, it is the whole window. */
export const liftRoom = (window: number, docked: number): number =>
  docked > 0 && docked < window ? window - docked : window;

/** How far a line of options moves so that option `index` stands at the middle of `whole`. */
export const lineShift = (sizes: readonly number[], index: number, whole: number, gap: number) =>
  whole / 2 - sizes.slice(0, index).reduce((sum, s) => sum + s + gap, 0) - (sizes[index] ?? 0) / 2;

/** The box around the first element of each selector, or nothing when none shows. */
/** An element's rect; one that shows its children only, as a part's, takes theirs. */
function rectOf(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect();
}

export function boxOf(selectors: readonly string[]): Box | undefined {
  const rects = selectors
    .map((s) => document.querySelector(s))
    .map((e) => (e === null ? undefined : rectOf(e)))
    .filter((r): r is DOMRect => r !== undefined && (r.width > 0 || r.height > 0));
  if (rects.length === 0) return undefined;
  const left = Math.min(...rects.map((r) => r.left)) - PAD;
  const top = Math.min(...rects.map((r) => r.top)) - PAD;
  const right = Math.max(...rects.map((r) => r.right)) + PAD;
  const bottom = Math.max(...rects.map((r) => r.bottom)) + PAD;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export const sameBox = (a: Box | undefined, b: Box | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5);

export type Side = "above" | "below" | "left" | "right";

/** Where a card is on the screen, and the side of the part it is on, if any. */
export interface Place {
  readonly left: number;
  readonly top: number;
  readonly side?: Side;
}

/** A width and a height: a card's, or the screen's. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * Where a card goes so that it covers as little of the part as it can. It stays on the side
 * it `stays` on while it still fits there, so it does not move as it grows; else it goes on
 * the side it prefers, then above, below, left or right; else in a free corner of the screen;
 * else where it covers the least of the part.
 */

export function placeCard(
  box: Box,
  card: Size,
  screen: Size,
  prefer: Side = "above",
  stays?: Side,
): Place {
  const bottom = screen.height - BAR;
  const across = (left: number) => Math.min(Math.max(left, EDGE), screen.width - card.width - EDGE);
  const down = (top: number) => Math.min(Math.max(top, EDGE), bottom - card.height);
  const sides: Readonly<Record<Side, Place>> = {
    above: { left: across(box.x), top: down(box.y - card.height - GAP), side: "above" },
    below: { left: across(box.x), top: down(box.y + box.height + GAP), side: "below" },
    left: { left: across(box.x - card.width - GAP), top: down(box.y), side: "left" },
    right: { left: across(box.x + box.width + GAP), top: down(box.y), side: "right" },
  };
  const corners: readonly Place[] = [
    { left: across(screen.width), top: down(bottom) },
    { left: EDGE, top: down(bottom) },
    { left: across(screen.width), top: EDGE },
    { left: EDGE, top: EDGE },
  ];
  const covers = (p: Place) =>
    overlap(box, { x: p.left, y: p.top, width: card.width, height: card.height });
  const order: readonly Side[] = [
    ...(stays === undefined ? [] : [stays]),
    prefer,
    "above",
    "below",
    "left",
    "right",
  ];
  const all = [...order.map((s) => sides[s]), ...corners];
  return (
    all.find((p) => covers(p) === 0) ??
    all.reduce((best, p) => (covers(p) < covers(best) ? p : best), sides[prefer])
  );
}

/** A place the reviewer dragged a card to, kept inside the screen. */
export const inside = (place: Place, card: Size, screen: Size): Place => ({
  left: Math.min(Math.max(place.left, EDGE), screen.width - card.width - EDGE),
  top: Math.min(Math.max(place.top, EDGE), screen.height - BAR - card.height),
});

/** A CSS path to the element, from the nearest element with one of the anchors, or the
 * body. */
export function pathTo(element: Element, anchors: readonly string[]): string {
  const parts: string[] = [];
  for (let e: Element | null = element; e !== null && e !== document.body; e = e.parentElement) {
    const anchor = anchors.find((a) => e?.hasAttribute(a) === true);
    if (anchor !== undefined) {
      parts.unshift(`[${anchor}="${CSS.escape(e.getAttribute(anchor) ?? "")}"]`);
      break;
    }
    const tag = e.tagName.toLowerCase();
    const parent: Element | null = e.parentElement;
    const kin = parent === null ? [] : [...parent.children].filter((c) => c.tagName === e?.tagName);
    parts.unshift(kin.length > 1 ? `${tag}:nth-of-type(${kin.indexOf(e) + 1})` : tag);
  }
  return parts.join(" > ");
}

/** Text in one line, cut to a few words. */
const words = (text: string | null | undefined, most = 48) => {
  const one = (text ?? "").replace(/\s+/g, " ").trim();
  return one.length > most ? `${one.slice(0, most)}…` : one;
};

const isControl = (e: Element): e is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
  e instanceof HTMLInputElement ||
  e instanceof HTMLTextAreaElement ||
  e instanceof HTMLSelectElement;

/** The text as the page shows it: the words of separate parts stay apart. */
const textOf = (e: Element | null | undefined) =>
  e instanceof HTMLElement ? e.innerText : e?.textContent;

/** A label without its required mark. */
const nameOf = (text: string | null | undefined) =>
  words((text ?? "").replace(/\s*\*?\s*\(required\)\s*$/, "").replace(/\s*\*\s*$/, ""));

/** The name of the place the element is in: its label, or the nearest heading above it. */
function placeOf(element: Element): string {
  if (isControl(element)) {
    const label = nameOf(textOf(element.labels?.[0]));
    if (label !== "") return label;
  }
  const label = element.closest("label");
  if (label !== null && label !== element) return nameOf(textOf(label));
  for (let e = element.parentElement; e !== null && e !== document.body; e = e.parentElement) {
    // A label that holds its own field names that field, not the parts beside it.
    const head = [
      ...e.querySelectorAll(
        ":scope > label, :scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4",
      ),
    ].find((h) => !(h instanceof HTMLLabelElement && h.control !== null && h.contains(h.control)));
    if (head !== undefined && !head.contains(element)) return nameOf(textOf(head));
  }
  return "";
}

/** The element in plain words, as a reviewer would say it: the “Safety” field. */
export function describe(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const place = placeOf(element);
  if (isControl(element))
    return place === "" ? `a ${tag === "select" ? "list" : "field"}` : `the “${place}” field`;
  const said = element.getAttribute("aria-label") ?? textOf(element);
  const text = nameOf(said) || words(said);
  const kind =
    tag === "button" || element.getAttribute("role") === "button"
      ? " button"
      : tag === "a"
        ? " link"
        : /^h[1-6]$/.test(tag)
          ? " heading"
          : "";
  if (text === "") return place === "" ? `a ${tag}` : `part of “${place}”`;
  if (text === place || place === "") return `the “${text}”${kind}`;
  return `the “${text}”${kind} in “${place}”`;
}

/** The page's element under a point, not the dev tools' own. */
export const under = (x: number, y: number) =>
  document.elementsFromPoint(x, y).find((e) => e.closest("[data-dt-ui]") === null);
