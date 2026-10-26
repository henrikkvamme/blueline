/*
 * Tailwind's CSS made fit for a shadow root (scripts/overlay-css.ts says why).
 */

/** The tools' own root elements. */
const OWN = ".blueline, .blueline-portal";

/** Each `rem` as `px` at 16 px, in values and at-rules, but not in a selector: a class such
 *  as `w-[7.5rem]` names its value. */
function remToPx(css: string): string {
  return css
    .split(/(?<=[{};])/)
    .map((part) =>
      part.endsWith("{") && !part.trimStart().startsWith("@")
        ? part
        : part.replace(/(\d*\.?\d+)rem\b/g, (_, n: string) => `${String(Number(n) * 16)}px`),
    )
    .join("");
}

/** The block that starts at `open`, the index of its `{`, to its matching `}`. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  throw new Error("The CSS has a block that does not end");
}

/** The CSS for a shadow root: each `@property` as its fallback in the lowest layer, `rem` as
 *  `px`, and `:root`, `html` and `:host` as the tools' own root elements. */
export function forShadowRoot(css: string): string {
  let out = css;
  // The fallback's test, so it applies in every browser.
  const layer = out.indexOf("@layer properties {");
  const test = out.indexOf("@supports", layer);
  if (layer < 0 || test < 0) throw new Error("Tailwind's properties layer has changed");
  const open = out.indexOf("{", test);
  const end = blockEnd(out, open);
  out = out.slice(0, test) + out.slice(open + 1, end) + out.slice(end + 1);
  out = out.replace(/@property\s+--[\w-]+\s*\{[^}]*\}\s*/g, "");
  out = remToPx(out);
  out = out.replace(/(?:html|:root),\s*:host\s*\{/g, `${OWN} {`);
  if (out.includes(":host")) throw new Error("The CSS still names :host");
  // What the page passes down stops at the tools' root, before the base gives its own.
  const baseAt = out.indexOf("@layer base {");
  if (baseAt < 0) throw new Error("Tailwind's base layer has changed");
  const at = baseAt + "@layer base {".length;
  return `${out.slice(0, at)}\n${OWN} { all: initial; }\n${out.slice(at)}`;
}
