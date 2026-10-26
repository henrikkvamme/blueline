/*
 * A still copy of a step's target: its elements with their computed styles in line, so the
 * copy looks as the page did after the page shows another variant, and in the lift, where it
 * is a light child of the lift's host and the page's CSS still reaches it (lift.tsx). A step
 * whose variants change the page, and not a part, shows these in the lift.
 *
 * Each element writes each property whose value differs from its tag's default or from its
 * parent's value; a target writes them all, as it inherits from the lift and not from its
 * parent. The values are `!important`, so the page's rules do not change the copy.
 */

/** The copy of a step's target: a box of the targets' joint rectangle. */
export interface Still {
  readonly element: HTMLElement;
  readonly width: number;
  readonly height: number;
}

const SVG = "http://www.w3.org/2000/svg";
/** Elements that draw nothing, or that would run again in the copy. */
const SKIP = new Set(["script", "style", "link", "template", "noscript", "meta", "base", "title"]);
/** Attributes that join the copy to the page's labels, radio groups and forms, and the ones
 * the styles in line replace. The IDs stay: the copy is in a shadow root of its own, and an
 * SVG's `url(#…)` and `<use href="#…">` find their own copies. */
const DROP = new Set([
  "name",
  "for",
  "form",
  "autofocus",
  "class",
  "style",
  "slot",
  "srcset",
  "sizes",
  "loading",
  "popover",
  "tabindex",
  "contenteditable",
  "data-blueline-part",
]);
/** The properties a copy never plays again. */
const STILL =
  "animation:none!important;transition:none!important;view-transition-name:none!important";
/** Where a scrolled element was scrolled to, put back once the copy is on the page. */
const SCROLL = "data-blueline-scroll";
const HOST = "[data-blueline-host]";

/** The computed styles of each tag as nothing styles it, from a document of its own. */
function defaults() {
  const frame = document.createElement("iframe");
  frame.dataset.bluelineHost = "";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1000px;height:1000px;border:0;visibility:hidden";
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc?.open();
  doc?.write("<!doctype html><html><head></head><body></body></html>");
  doc?.close();
  const known = new Map<string, ReadonlyMap<string, string>>();
  return {
    of: (ns: string | null, name: string): ReadonlyMap<string, string> => {
      const key = `${ns ?? ""} ${name}`;
      const had = known.get(key);
      if (had !== undefined) return had;
      const values = new Map<string, string>();
      const view = doc?.defaultView;
      if (doc != null && view != null) {
        const el = ns === null ? doc.createElement(name) : doc.createElementNS(ns, name);
        doc.body.append(el);
        const style = view.getComputedStyle(el);
        for (const p of style) values.set(p, style.getPropertyValue(p));
        el.remove();
      }
      known.set(key, values);
      return values;
    },
    dispose: () => frame.remove(),
  };
}

type Defaults = ReturnType<typeof defaults>;

/** The style in line for an element whose page style is `style`. */
function styleOf(
  style: CSSStyleDeclaration,
  base: ReadonlyMap<string, string>,
  parent: CSSStyleDeclaration | undefined,
) {
  const out: string[] = [];
  for (const p of style) {
    if (p.startsWith("--")) continue;
    const value = style.getPropertyValue(p);
    if (parent !== undefined && value === base.get(p) && value === parent.getPropertyValue(p))
      continue;
    out.push(`${p}:${value}!important`);
  }
  out.push(STILL);
  return out.join(";");
}

/** The words of a pseudo-element's `content`, when it is one string. */
function contentText(content: string): string | undefined {
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(content);
  if (quoted === null) return undefined;
  return (quoted[1] ?? "")
    .replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1");
}

/** The copy of `::before` or `::after`, as a span, or none when it draws nothing. */
function pseudoOf(
  el: Element,
  which: "::before" | "::after",
  made: Defaults,
  style: CSSStyleDeclaration,
) {
  const pseudo = getComputedStyle(el, which);
  const content = pseudo.getPropertyValue("content");
  if (content === "none" || content === "normal" || pseudo.getPropertyValue("display") === "none")
    return undefined;
  const span = document.createElement("span");
  span.setAttribute("style", styleOf(pseudo, made.of(null, "span"), style));
  span.textContent = contentText(content) ?? "";
  return span;
}

/** The element that stands for `el` in the copy, and the tag its defaults come from. */
function shellOf(el: Element): Element {
  if (el.namespaceURI === SVG) return document.createElementNS(SVG, el.localName);
  if (el instanceof HTMLCanvasElement) {
    const img = document.createElement("img");
    try {
      img.src = el.toDataURL();
    } catch {
      // A canvas with pixels from another origin draws as an empty box of its size.
    }
    return img;
  }
  if (el instanceof HTMLVideoElement) {
    const img = document.createElement("img");
    if (el.poster !== "") img.src = el.poster;
    return img;
  }
  if (el instanceof HTMLSlotElement) return document.createElement("span");
  // An iframe is an empty box of its size; a custom element is a plain one, so its own code
  // does not start again in the copy.
  if (el instanceof HTMLIFrameElement || el.localName.includes("-"))
    return document.createElement("div");
  return document.createElement(el.localName);
}

/** The attributes the copy keeps, and the state of a form's fields. */
function attributesOf(el: Element, shell: Element) {
  if (shell.localName === el.localName)
    for (const { name, value } of el.attributes) {
      if (DROP.has(name) || name.startsWith("on")) continue;
      try {
        shell.setAttribute(name, value);
      } catch {
        // A name the page set by script that markup cannot hold.
      }
    }
  if (el instanceof HTMLImageElement && shell instanceof HTMLImageElement && el.currentSrc !== "")
    shell.src = el.currentSrc;
  if (el instanceof HTMLInputElement) {
    shell.setAttribute("value", el.value);
    if (el.checked) shell.setAttribute("checked", "");
    else shell.removeAttribute("checked");
  }
  if (el instanceof HTMLTextAreaElement) shell.textContent = el.value;
  if (el instanceof HTMLOptionElement) {
    if (el.selected) shell.setAttribute("selected", "");
    else shell.removeAttribute("selected");
  }
  if (el.scrollLeft !== 0 || el.scrollTop !== 0)
    shell.setAttribute(SCROLL, `${String(el.scrollLeft)} ${String(el.scrollTop)}`);
}

/** The nodes an element draws: its shadow root's, a slot's assigned ones, or its own. */
function drawnOf(el: Element): readonly Node[] {
  if (el instanceof HTMLSlotElement) {
    const assigned = el.assignedNodes();
    return assigned.length > 0 ? assigned : [...el.childNodes];
  }
  return [...(el.shadowRoot ?? el).childNodes];
}

/** Where a fixed element stood in the box, put back once the copy is shown. */
const AT = "data-blueline-at";
/** How many elements a still copies at most. */
export const MOST_ELEMENTS = 20_000;

/** Puts an element at a place in the box, with its own size and no move of its own. */
function placeAt(el: Element, position: "absolute" | "fixed", left: number, top: number) {
  el.setAttribute(
    "style",
    `${el.getAttribute("style") ?? ""};position:${position}!important;left:${String(left)}px!important;top:${String(top)}px!important;right:auto!important;bottom:auto!important;margin:0!important;transform:none!important;translate:none!important;rotate:none!important;scale:none!important`,
  );
}

/** One copying: the box on the page, its defaults and how many elements it copied. */
interface Copying {
  readonly box: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly made: Defaults;
  readonly most: number;
  count: number;
}

class TooBig extends Error {}

const outside = (rect: DOMRect, box: Copying["box"]) =>
  (rect.width > 0 || rect.height > 0) &&
  (rect.right <= box.left ||
    rect.left >= box.right ||
    rect.bottom <= box.top ||
    rect.top >= box.bottom);

/** The copy of a node, whose parent on the page has the style `parent`; none for a target. */
function copyOf(
  node: Node,
  copying: Copying,
  parent: CSSStyleDeclaration | undefined,
): Node | undefined {
  if (node instanceof Text) return node.cloneNode();
  if (!(node instanceof Element)) return undefined;
  if (SKIP.has(node.localName) || node.matches(HOST)) return undefined;
  copying.count += 1;
  if (copying.count > copying.most) throw new TooBig();
  const { made, box } = copying;
  const style = getComputedStyle(node);
  const shell = shellOf(node);
  attributesOf(node, shell);
  shell.setAttribute(
    "style",
    styleOf(style, made.of(shell.namespaceURI === SVG ? SVG : null, shell.localName), parent),
  );
  const rect = node.getBoundingClientRect();
  // A fixed element's place is the window's: in the copy it stands where it was in the box.
  if (style.position === "fixed") {
    placeAt(shell, "fixed", rect.left - box.left, rect.top - box.top);
    shell.setAttribute(AT, `${String(rect.left - box.left)} ${String(rect.top - box.top)}`);
  }
  // A textarea's words are its value, and an iframe's page is not the copy's.
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLIFrameElement) return shell;
  if (node instanceof HTMLCanvasElement || node instanceof HTMLVideoElement) return shell;
  // An element out of the box keeps its size, so what follows it keeps its place, and not
  // what it holds: a long page costs what shows.
  if (parent !== undefined && style.position !== "fixed" && outside(rect, box)) return shell;
  const before = node.namespaceURI === SVG ? undefined : pseudoOf(node, "::before", made, style);
  if (before !== undefined) shell.append(before);
  for (const child of drawnOf(node)) {
    const copy = copyOf(child, copying, style);
    if (copy !== undefined) shell.append(copy);
  }
  const after = node.namespaceURI === SVG ? undefined : pseudoOf(node, "::after", made, style);
  if (after !== undefined) shell.append(after);
  return shell;
}

/** Where an element is on the page: its box, or its content's for one that draws no box. */
function boxOf(el: Element): DOMRect {
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect();
}

/** The colour behind the element: the first one an ancestor paints, else the page's. */
function backgroundOf(el: Element): string {
  for (let at: Element | null = el; at !== null; at = at.parentElement) {
    const color = getComputedStyle(at).backgroundColor;
    if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
  }
  return "Canvas";
}

/**
 * Copies the targets as the page shows them now: each at its place in the box of their
 * joint rectangle. With none, it copies the page, cut to the window. None when it would
 * copy more than `most` elements.
 */
export function stillOf(
  targets: readonly Element[],
  { most = MOST_ELEMENTS }: { readonly most?: number } = {},
): Still | undefined {
  const page = targets.length === 0;
  const roots = page ? [document.body] : targets;
  const rects = roots.map(boxOf);
  const left = page ? 0 : Math.min(...rects.map((r) => r.left));
  const top = page ? 0 : Math.min(...rects.map((r) => r.top));
  const width = page ? window.innerWidth : Math.max(...rects.map((r) => r.right)) - left;
  const height = page ? window.innerHeight : Math.max(...rects.map((r) => r.bottom)) - top;
  const box = document.createElement("div");
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  box.setAttribute(
    "style",
    `position:relative;display:block;width:${String(width)}px;height:${String(height)}px;overflow:hidden;contain:paint;color-scheme:${scheme};background:${backgroundOf(roots[0] ?? document.body)}`,
  );
  const copying: Copying = {
    box: { left, top, right: left + width, bottom: top + height },
    made: defaults(),
    most,
    count: 0,
  };
  try {
    roots.forEach((root, i) => {
      const copy = copyOf(root, copying, undefined);
      const rect = rects[i];
      if (!(copy instanceof Element) || rect === undefined) return;
      placeAt(copy, "absolute", rect.left - left, rect.top - top);
      box.append(copy);
    });
  } catch (error) {
    if (error instanceof TooBig) return undefined;
    throw error;
  } finally {
    copying.made.dispose();
  }
  return { element: box, width, height };
}

/**
 * Shows a copy of the still in a shadow root of `into`'s, so the page's queries do not find
 * it and the page's CSS does not reach it. It is scrolled as the page was, and each fixed
 * element moves to where it stood in the box, whatever its containing block is in the copy.
 * Gives the copy back.
 */
export function showStill(still: Still, into: Element): HTMLElement | undefined {
  const root = into.shadowRoot ?? into.attachShadow({ mode: "open" });
  const copy = still.element.cloneNode(true);
  root.replaceChildren(copy);
  if (!(copy instanceof HTMLElement)) return undefined;
  for (const el of copy.querySelectorAll(`[${SCROLL}]`)) {
    const [x, y] = (el.getAttribute(SCROLL) ?? "").split(" ").map(Number);
    el.scrollTo(x ?? 0, y ?? 0);
  }
  const box = copy.getBoundingClientRect();
  // The lift may draw the copy at another scale than the page's.
  const scale = still.width > 0 ? box.width / still.width : 1;
  const moves = [...copy.querySelectorAll(`[${AT}]`)].map((el) => {
    const [x = 0, y = 0] = (el.getAttribute(AT) ?? "").split(" ").map(Number);
    const rect = el.getBoundingClientRect();
    return { el, x: x - (rect.left - box.left) / scale, y: y - (rect.top - box.top) / scale };
  });
  for (const { el, x, y } of moves) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    const style = getComputedStyle(el);
    el.style.setProperty("left", `${String(parseFloat(style.left) + x)}px`, "important");
    el.style.setProperty("top", `${String(parseFloat(style.top) + y)}px`, "important");
  }
  return copy;
}
