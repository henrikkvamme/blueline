/*
 * Where the dev tools' own nodes are: the document, or the shadow root that holds the tools
 * (mount.tsx). A query for a node of the tools looks there; a query for the page's own nodes,
 * as a step's target or a pin's selector, looks in the document. Focus and an event's target
 * are read through the shadow root, which the page sees as one host element.
 */

let root: Document | ShadowRoot | undefined;

/** The node the tools' own nodes are in. */
export const ownRoot = (): Document | ShadowRoot => root ?? document;

/** Puts the tools' nodes in `next`, or in the document again with `undefined`. */
export function setOwnRoot(next: ShadowRoot | undefined) {
  root = next;
}

/** The tools' own node that `selector` names. */
export const own = <E extends Element = HTMLElement>(selector: string): E | null =>
  ownRoot().querySelector<E>(selector);

/** The tools' own nodes that `selector` names. */
export const ownAll = <E extends Element = HTMLElement>(selector: string): E[] => [
  ...ownRoot().querySelectorAll<E>(selector),
];

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
