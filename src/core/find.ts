/*
 * The element a selector names, for a selector that comes from outside Blueline: an agent's
 * reply block, a journey step's target or a config's action. Words that are no CSS selector,
 * such as "the follow-up's send", find nothing. querySelector throws on them, and a throw in
 * a render reaches the page's own error boundary and takes the whole app down.
 */

/** The first element that matches the selector, or null when none does or it is no selector. */
export function find(selector: string, root: ParentNode = document): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}
