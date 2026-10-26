import { DevTools, useReviewControl, type DevAdapter } from "@henrikkvamme/blueline/react";
import { StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

/*
 * `<DevTools>` from the React entry, as a React app puts it on the page: one overlay has the
 * page, and the app's own parts reach it from their first effect.
 */

const adapter: DevAdapter<void> = {
  journeys: [
    {
      id: "check",
      title: "Check",
      steps: [{ id: "first", title: "The first step", group: { id: "g", title: "G" }, look: "" }],
    },
  ],
  context: () => undefined,
  enter: () => undefined,
};

const hosts = () => document.querySelectorAll("blueline-tools").length;
const words = () => document.querySelector("blueline-tools")?.shadowRoot?.textContent ?? "";
/** Waits a few frames, so a state that React has queued is drawn. */
const settled = () => new Promise((done) => setTimeout(done, 300));

describe("<DevTools> on a React page", () => {
  let root: Root | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    localStorage.clear();
  });

  function render(node: React.ReactNode) {
    const at = document.createElement("div");
    document.body.append(at);
    root = createRoot(at);
    root.render(node);
  }

  it("keeps one overlay when two start in their own StrictMode", async () => {
    render(
      <>
        <StrictMode>
          <DevTools adapter={adapter} storageKey="owner.review" />
        </StrictMode>
        <StrictMode>
          <DevTools adapter={adapter} storageKey="owner.review" />
        </StrictMode>
      </>,
    );
    await expect.poll(hosts).toBe(1);
    await settled();
    expect(hosts()).toBe(1);
  });

  it("starts a review that a part asks for in its first effect", async () => {
    function Starter() {
      const review = useReviewControl();
      useEffect(() => review.start("check", 0, false), [review]);
      return null;
    }
    render(
      <DevTools adapter={adapter} storageKey="owner.review">
        <Starter />
      </DevTools>,
    );
    await expect.poll(words).toContain("The first step");
  });
});
