/*
 * Markup from the agent, for a mock-up in an element's place and for a variant that it
 * designs: cleaned so that it only shows, and drawn in the look of the element it stands for.
 */

/** The look of the element that the markup copies, so it reads as the page's own. */
const LOOK = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "background-color",
  "border-radius",
  "padding",
  "display",
  "align-items",
  "justify-content",
  "gap",
  "text-align",
] as const;

export const lookOf = (element: Element): Readonly<Record<string, string>> => {
  const computed = getComputedStyle(element);
  // In React's names for a style: letterSpacing, not letter-spacing.
  return Object.fromEntries(
    LOOK.map((name) => [
      name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
      computed.getPropertyValue(name),
    ]),
  );
};

/** Markup from the agent, with no scripts, frames or handlers: it only shows. */
export function clean(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const bad of doc.body.querySelectorAll("script, iframe, object, embed, link, style, meta"))
    bad.remove();
  for (const element of doc.body.querySelectorAll("*"))
    // A copy of the names: removing from the live list as it is read would skip some.
    for (const name of element.getAttributeNames())
      if (/^on/i.test(name) || /javascript:/i.test(element.getAttribute(name) ?? ""))
        element.removeAttribute(name);
  return doc.body.innerHTML;
}

/** A design with the words of the state that it shows in place of `{state}`. */
export const fill = (html: string, state: string) =>
  html.replaceAll(
    "{state}",
    state.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`),
  );
