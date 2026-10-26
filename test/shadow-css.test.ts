import { describe, expect, it } from "vitest";
import { forShadowRoot } from "../scripts/shadow-css.ts";

/** The parts of Tailwind's output that the shadow root changes. */
const TAILWIND = `@layer properties {
  @supports (((-webkit-hyphens: none)) and (not (margin-trim: inline))) {
    *, :before, :after, ::backdrop { --tw-translate-x: 0; --tw-rotate-x: initial; }
  }
}
@layer theme { :root, :host { --spacing: .25rem; } }
@layer base { html, :host { line-height: 1.5; } }
@layer utilities { .w-\\[7\\.5rem\\] { width: 7.5rem; } .translate-x-1\\/2 { --tw-translate-x: 50%; } }
@property --tw-translate-x { syntax: "*"; inherits: false; initial-value: 0; }
@property --tw-rotate-x { syntax: "*"; inherits: false; }
`;

describe("the tools' CSS in a shadow root", () => {
  const css = forShadowRoot(TAILWIND);

  it("gives each variable its initial value in the lowest layer, in every browser", () => {
    expect(css).not.toContain("@supports");
    expect(css).not.toContain("@property");
    expect(css).toMatch(
      /@layer properties \{\s*\*, :before, :after, ::backdrop \{ --tw-translate-x: 0;/,
    );
    // The utility, in a later layer, still wins over the initial value.
    expect(css.indexOf("--tw-translate-x: 50%")).toBeGreaterThan(css.indexOf("@layer utilities"));
  });

  it("sizes in px, so the page's root font size does not resize the tools", () => {
    expect(css).toContain("--spacing: 4px");
    expect(css).toContain("width: 120px");
    // A class names its value in rem, and keeps its name.
    expect(css).toContain(".w-\\[7\\.5rem\\] {");
    expect(css.replaceAll(".w-\\[7\\.5rem\\]", "")).not.toContain("rem");
  });

  it("puts the theme and the base on the tools' own root, which takes back what it inherits", () => {
    expect(css).not.toContain(":host");
    expect(css).not.toContain(":root");
    expect(css).toContain(".blueline, .blueline-portal { --spacing: 4px; }");
    expect(css).toMatch(
      /@layer base \{\n\.blueline, \.blueline-portal \{ all: initial; \}\n \.blueline, \.blueline-portal \{ line-height: 1\.5; \}/,
    );
  });
});
