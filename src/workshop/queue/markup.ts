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

/** What can run code, load a page or change one: it goes, with what it holds. */
const DROP =
  "script, iframe, frame, frameset, object, embed, applet, link, style, meta, base, template, noscript, foreignObject, use, animate, animateMotion, animateTransform, set";

/** The attributes that hold a URL. Only an image's own source keeps one. */
const URLS = new Set([
  "href",
  "xlink:href",
  "src",
  "srcset",
  "action",
  "formaction",
  "poster",
  "background",
  "data",
  "ping",
  "srcdoc",
  "codebase",
  "cite",
  "longdesc",
  "usemap",
  "manifest",
]);

/** An image from the web or a still in the markup. The browser drops tabs and spaces in a URL,
 * so they go before the check, as `java\tscript:` is `javascript:`. */
const image = (value: string) =>
  // oxlint-disable-next-line no-control-regex -- the controls are what the browser drops
  /^(https?:|data:image\/(png|jpeg|gif|webp)[;,])/i.test(value.replace(/[\u0000-\u0020]/g, ""));

/** The parts that belong to a form, and send it. */
const FIELDS = "button, input, select, textarea, fieldset, output";

/** A form ID that no page has: a field that names it belongs to no form. */
const NO_FORM = "blueline-no-form";

/**
 * Markup from the agent, inert: it only shows. No scripts, frames, handlers or links, and no
 * form that sends; an image keeps a web or still source. Its fields belong to no form, also
 * when the page puts the markup inside one, and its buttons submit nothing.
 */
export function clean(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const bad of doc.body.querySelectorAll(DROP)) bad.remove();
  for (const form of doc.body.querySelectorAll("form")) form.replaceWith(...form.childNodes);
  for (const element of doc.body.querySelectorAll("*")) {
    const media = element.tagName === "IMG" || element.tagName === "SOURCE";
    // A copy of the names: removing from the live list as it is read would skip some.
    for (const name of element.getAttributeNames()) {
      const value = element.getAttribute(name) ?? "";
      const lower = name.toLowerCase();
      const kept = URLS.has(lower)
        ? media && lower === "src" && image(value)
        : !lower.startsWith("on") && !lower.startsWith("form");
      if (!kept) element.removeAttribute(name);
    }
  }
  for (const field of doc.body.querySelectorAll(FIELDS)) {
    field.setAttribute("form", NO_FORM);
    const type = field.getAttribute("type")?.toLowerCase();
    if (field.tagName === "BUTTON" || type === "submit" || type === "image" || type === "reset")
      field.setAttribute("type", "button");
  }
  return doc.body.innerHTML;
}

/** A design with the words of the state that it shows in place of `{state}`. */
export const fill = (html: string, state: string) =>
  html.replaceAll(
    "{state}",
    state.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`),
  );
