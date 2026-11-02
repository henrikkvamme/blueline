import { describe, expect, it } from "vitest";
import { find } from "../src/core/find";

/*
 * A selector can come from outside Blueline: an agent's reply block, a journey's target or
 * a config's action. One that is not a CSS selector, such as plain words, finds nothing; it
 * must not throw, or the page's error boundary takes the whole app down.
 */

/** A root that matches like `document`, and throws on an invalid selector as browsers do. */
const root = {
  querySelector: (selector: string) => {
    if (selector.includes("'")) throw new SyntaxError(`'${selector}' is not a valid selector.`);
    return selector === "#here" ? ({ id: "here" } as unknown as Element) : null;
  },
} as unknown as ParentNode;

describe("finding an element by a selector from outside", () => {
  it("finds the element a valid selector names", () => {
    expect(find("#here", root)).toEqual({ id: "here" });
  });

  it("finds nothing for a selector that matches nothing", () => {
    expect(find("#gone", root)).toBeNull();
  });

  it("finds nothing, and does not throw, for words that are no selector", () => {
    expect(find("the follow-up's send", root)).toBeNull();
  });
});
