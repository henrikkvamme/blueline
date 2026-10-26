/*
 * Where the dev tools' own nodes are: the document, and the shadow roots that hold the tools
 * (mount.tsx) and the lift. A query for a node of the tools looks in each; a query for the
 * page's own nodes, as a step's target or a pin's selector, looks in the document. Focus and
 * an event's target are read through a shadow root, which the page sees as one host element.
 */

const roots = new Set<ShadowRoot>();

/** The nodes the tools' own nodes are in: the document first. */
export const ownRoots = (): readonly (Document | ShadowRoot)[] => [document, ...roots];

/** Puts some of the tools' nodes in `root` too, until the returned function takes it out. */
export function addOwnRoot(root: ShadowRoot): () => void {
  roots.add(root);
  return () => void roots.delete(root);
}

/** The tools' own node that `selector` names. */
export function own<E extends Element = HTMLElement>(selector: string): E | null {
  for (const root of ownRoots()) {
    const found = root.querySelector<E>(selector);
    if (found !== null) return found;
  }
  return null;
}

/** The tools' own nodes that `selector` names. */
export const ownAll = <E extends Element = HTMLElement>(selector: string): E[] =>
  ownRoots().flatMap((root) => [...root.querySelectorAll<E>(selector)]);

/** The element that has focus, inside a shadow root too. */
export function focused(): Element | null {
  let at = document.activeElement;
  while (at?.shadowRoot?.activeElement != null) at = at.shadowRoot.activeElement;
  return at;
}

/** The node an event started at, inside a shadow root too: a DOM event or React's. */
export function targetOf(event: Event | { readonly nativeEvent: Event }): EventTarget | null {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.composedPath()[0] ?? native.target;
}

/** The element an event started at, if it started at an element. */
export function elementOf(event: Event | { readonly nativeEvent: Event }): Element | null {
  const target = targetOf(event);
  return target instanceof Element ? target : null;
}

/** What marks the tools' own nodes, and the host that holds them on the page. */
export const OWN = "[data-dt-ui], [data-blueline-host], .blueline, .blueline-portal";

/** Whether an element is the tools' own, not the page's. */
export const isOwn = (element: Element) => element.closest(OWN) !== null;
