import { shared } from "../core/shared";
import { parts, variantOf, type Stage } from "./store";

/*
 * Parts without React. A part is a place on the page, marked `data-blueline-part="<name>"`,
 * and the code that draws it, from any framework:
 *
 *   const rows = part("Request rows", {
 *     variants: ["Table", "Cards"],
 *     states: ["Empty"],
 *     show: (into, { variant, state, source }) => mountRows(into, rowsOf(source), variant, state),
 *   });
 *   rows.subscribe(() => render(rows.shown()));
 *
 * The marked element holds the part: `show` draws what goes inside it. The app draws the
 * element on the page from `shown`; Blueline draws the lift's copies with `show`, each a
 * light child of the lift's host in its slot (lift.tsx). A part in plain HTML needs no
 * code: its templates are its variants and states (`markup`).
 */

/** What a part shows: a variant, in a state or none for the page's own. */
export interface PartShown {
  readonly variant: string;
  readonly state: string | undefined;
}

export interface PartOptions {
  /** The variants' labels; the first is the one the app ships. */
  readonly variants: readonly string[];
  /** The states' names, besides the page's own. */
  readonly states?: readonly string[];
  /** Draws a copy of the part into `into`: the variant, in the state, of the part whose
   * element on the page is `source`. Returns what takes it out again and stops what it
   * started. */
  readonly show: (
    into: Element,
    shown: PartShown & { readonly source: Element },
  ) => void | (() => void);
}

export interface Part {
  /** What the page shows of the part now. */
  readonly shown: () => PartShown;
  /** Calls `listener` when what the page shows of the part changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Takes the part, its instances and its lift's copies away. */
  readonly dispose: () => void;
}

/** A part's code, as `part` or the markup gives it. */
interface Kind {
  readonly labels: readonly string[];
  readonly states: readonly string[];
  readonly show: PartOptions["show"];
}

/** A copy in the lift: its element, what it shows, and what takes it out. */
interface Copy {
  readonly element: HTMLElement;
  readonly key: string;
  readonly undo: (() => void) | undefined;
}

/** A marked element the observer found: its instance in the store and its copies. */
interface Found {
  readonly id: string;
  readonly name: string;
  readonly kind: Kind;
  /** Whether `part` gave the code, and not the element's templates. */
  readonly code: boolean;
  readonly remove: () => void;
  host: Element | undefined;
  readonly copies: Map<string, Copy>;
  /** A markup part's own content, while another variant or a state shows on the page. */
  page: { readonly key: string; readonly parked: DocumentFragment } | undefined;
}

const MARK = "data-blueline-part";
const HOST = "[data-blueline-host]";

interface Shared {
  /** The parts' code, by name, as `part` gives it. */
  readonly kinds: Map<string, Kind>;
  readonly elements: Map<Element, Found>;
  observer: MutationObserver | undefined;
  next: number;
}

/** The declared parts and the observer, shared by every copy of Blueline on the page. */
const found = shared("found", (): Shared => ({
  kinds: new Map(),
  elements: new Map(),
  observer: undefined,
  next: 0,
}));

/** What the page shows of a part of this name, with its labels and states. */
function shownOf(name: string, labels: readonly string[], states: readonly string[]): PartShown {
  const now = parts.shown(name);
  const variant = variantOf(labels, now, parts.verdicts(name));
  const state = now.state !== undefined && states.includes(now.state) ? now.state : undefined;
  return { variant, state };
}

const keyOf = (shown: PartShown) => `${shown.variant}\n${shown.state ?? ""}`;

// ---- Markup: a part in plain HTML, its variants and states in templates.

const VARIANT = "data-blueline-variant";
const STATE = "data-blueline-state";

const templatesOf = (element: Element) =>
  [...element.children].filter((c): c is HTMLTemplateElement => c instanceof HTMLTemplateElement);

/** A markup part's code, from its templates; none when the element has none. */
function markup(element: Element): Kind | undefined {
  const templates = templatesOf(element);
  if (templates.length === 0) return undefined;
  const base = element.getAttribute(VARIANT) ?? "";
  const unique = (list: readonly string[]) => [...new Set(list)];
  const labels = unique([
    base,
    ...templates.flatMap((t) => {
      const label = t.getAttribute(VARIANT);
      return label === null ? [] : [label];
    }),
  ]);
  const states = unique(
    templates.flatMap((t) => {
      const name = t.getAttribute(STATE);
      return name === null ? [] : [name];
    }),
  );
  /** The template for the variant in the state: none for the element's own content. A
   * variant with no template for the state shows as it is. */
  const templateOf = (variant: string, state: string | undefined) => {
    const match = (s: string | undefined) =>
      templates.find(
        (t) =>
          (t.getAttribute(VARIANT) ?? base) === variant &&
          (t.getAttribute(STATE) ?? undefined) === s,
      );
    return (state === undefined ? undefined : match(state)) ?? match(undefined);
  };
  const show: PartOptions["show"] = (into, { variant, state, source }) => {
    const template = templateOf(variant, state);
    into.append(
      ...(template === undefined
        ? drawnIn(source).map((n) => n.cloneNode(true))
        : [template.content.cloneNode(true)]),
    );
  };
  return { labels, states, show };
}

/** The element's children that are not templates: what it draws. */
const drawnIn = (element: Element) =>
  [...element.childNodes].filter((n) => !(n instanceof HTMLTemplateElement));

/** Draws a markup part on the page: its own content for the first variant as it is, else
 * a template's copy, with its own content put aside until it shows again. */
function drawPage(element: Element, entry: Found) {
  const shown = shownOf(entry.name, entry.kind.labels, entry.kind.states);
  const key = keyOf(shown);
  const own = keyOf({ variant: entry.kind.labels[0] ?? "", state: undefined });
  if ((entry.page?.key ?? own) === key) return;
  const drawn = drawnIn(element);
  let parked = entry.page?.parked;
  if (parked === undefined) {
    parked = document.createDocumentFragment();
    parked.append(...drawn);
  } else for (const n of drawn) n.remove();
  if (key === own) {
    element.prepend(parked);
    entry.page = undefined;
    return;
  }
  const source = sourceOf(element, parked);
  entry.page = { key, parked };
  const holder = document.createElement("div");
  entry.kind.show(holder, { ...shown, source });
  element.prepend(...holder.childNodes);
}

/** The element `show` copies from: while a markup part's own content is put aside, a
 * stand-in that holds it. */
function sourceOf(element: Element, parked: DocumentFragment | undefined): Element {
  if (parked === undefined) return element;
  const source = document.createElement(element.tagName);
  source.append(parked.cloneNode(true));
  return source;
}

/** Puts a markup part's own content back, as Blueline leaves it. */
function restorePage(element: Element, entry: Found) {
  if (entry.page === undefined) return;
  for (const n of drawnIn(element)) n.remove();
  element.prepend(entry.page.parked);
  entry.page = undefined;
}

// ---- The lift's copies.

/** Keeps one copy for each of the stage's slots while the element's part is lifted, and
 * none after. */
function drawCopies(element: Element, entry: Found, stage: Stage | undefined) {
  const mine = stage?.id === entry.id ? stage : undefined;
  if (mine?.host !== entry.host) {
    clearCopies(entry);
    entry.host = mine?.host;
  }
  if (mine === undefined) return;
  const states = entry.kind.states;
  const wanted = new Set<string>();
  for (const option of mine.options) {
    wanted.add(option.slot);
    const shown: PartShown = {
      variant: option.variant,
      state: option.state === 0 ? undefined : states[option.state - 1],
    };
    const key = keyOf(shown);
    const had = entry.copies.get(option.slot);
    if (had?.key === key) continue;
    had?.undo?.();
    const copy = had?.element ?? document.createElement("div");
    copy.replaceChildren();
    copy.slot = option.slot;
    copy.style.display = "contents";
    if (had === undefined) mine.host.append(copy);
    const undo = entry.kind.show(copy, { ...shown, source: sourceOf(element, entry.page?.parked) });
    entry.copies.set(option.slot, { element: copy, key, undo: undo ?? undefined });
  }
  for (const [slot, copy] of entry.copies)
    if (!wanted.has(slot)) {
      copy.undo?.();
      copy.element.remove();
      entry.copies.delete(slot);
    }
}

function clearCopies(entry: Found) {
  for (const copy of entry.copies.values()) {
    copy.undo?.();
    copy.element.remove();
  }
  entry.copies.clear();
}

// ---- Finding the marked elements.

/** Matches the store's instances to the marked elements on the page now. */
function sync() {
  const now = new Set<Element>();
  // The elements a part already holds, as a React part's (variants.tsx).
  const held = new Set(parts.current().instances.flatMap((i) => i.node() ?? []));
  for (const element of document.querySelectorAll(`[${MARK}]`)) {
    if (element.closest(HOST) !== null) continue;
    const name = element.getAttribute(MARK) ?? "";
    const declared = found.kinds.get(name);
    const had = found.elements.get(element);
    if (had !== undefined) {
      const same = had.name === name && (had.code ? had.kind === declared : declared === undefined);
      if (same) {
        now.add(element);
        continue;
      }
      end(element, had);
    } else if (held.has(element)) continue;
    const kind = declared ?? markup(element);
    if (name === "" || kind === undefined) continue;
    now.add(element);
    const id = `part-${String((found.next += 1))}`;
    parts.declare(name, kind.labels);
    const remove = parts.add({
      id,
      name,
      labels: kind.labels,
      states: kind.states,
      node: () => element,
    });
    found.elements.set(element, {
      id,
      name,
      kind,
      code: declared !== undefined,
      remove,
      host: undefined,
      copies: new Map(),
      page: undefined,
    });
  }
  for (const [element, entry] of found.elements) if (!now.has(element)) end(element, entry);
  draw();
}

/** Ends a marked element's instance and its copies. */
function end(element: Element, entry: Found) {
  clearCopies(entry);
  restorePage(element, entry);
  found.elements.delete(element);
  entry.remove();
}

/** Draws each found part's copies, and a markup part on the page. */
function draw() {
  const { stage } = parts.current();
  for (const [element, entry] of found.elements) {
    drawCopies(element, entry, stage);
    if (!entry.code) drawPage(element, entry);
  }
}

/** Starts finding the marked elements on the page, once for every copy of Blueline. */
export function watchParts() {
  if (found.observer !== undefined) return;
  found.observer = new MutationObserver(sync);
  found.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [MARK],
  });
  parts.subscribe(draw);
  sync();
}

/** A part of the page, drawn by the app's code: see the top of this file. */
export function part(name: string, options: PartOptions): Part {
  const kind: Kind = {
    labels: options.variants,
    states: options.states ?? [],
    show: options.show,
  };
  if (kind.labels.length === 0) throw new Error(`The part "${name}" has no variants.`);
  found.kinds.set(name, kind);
  parts.declare(name, kind.labels);
  watchParts();
  sync();
  const shown = () => shownOf(name, kind.labels, kind.states);
  return {
    shown,
    subscribe: (listener) => {
      let was = keyOf(shown());
      return parts.subscribe(() => {
        const key = keyOf(shown());
        if (key === was) return;
        was = key;
        listener();
      });
    },
    dispose: () => {
      if (found.kinds.get(name) !== kind) return;
      found.kinds.delete(name);
      for (const [element, entry] of found.elements) if (entry.kind === kind) end(element, entry);
    },
  };
}
