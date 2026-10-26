import { DevTools, useReviewControl, type DevAdapter } from "@henrikkvamme/blueline/react";
import { variants } from "@henrikkvamme/blueline/variants";
import { StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { startReview } from "../../../src/core/owner";
import { parts } from "../../../src/part/store";

/*
 * `<DevTools>` from the React entry, as a React app puts it on the page: one overlay has the
 * page, and the app's own parts reach it from their first effect.
 */

const adapter: DevAdapter<void> = {
  journeys: [
    {
      id: "check",
      title: "Check",
      steps: [
        { id: "first", title: "The first step", group: { id: "g", title: "G" }, look: "" },
        {
          id: "outer",
          title: "The outer part",
          group: { id: "g", title: "G" },
          look: "",
          target: ["#outer"],
          part: "Outer",
        },
      ],
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

  it("adds no instance for a part nested in a lifted part's copy", async () => {
    const Inner = variants("Inner", { Plain: () => <i>inner</i>, Bold: () => <b>inner</b> });
    const Outer = variants("Outer", {
      Narrow: () => (
        <p>
          narrow <Inner />
        </p>
      ),
      Wide: () => (
        <p>
          wide <Inner />
        </p>
      ),
    });
    const inner = () => parts.current().instances.filter((i) => i.name === "Inner").length;
    render(
      <DevTools adapter={adapter} storageKey="owner.review">
        <div id="outer">
          <Outer />
        </div>
      </DevTools>,
    );
    await expect.poll(inner).toBe(1);
    await expect.poll(hosts).toBe(1);
    const host = () => document.querySelector("blueline-lift");
    // The review starts on the outer part's step, and v lifts it.
    startReview("check", 1, false);
    await expect.poll(words).toContain("The outer part");
    await userEvent.keyboard("v");
    // Two variants on the row, and the column's part as it is.
    await expect.poll(() => host()?.querySelectorAll(":scope > [slot]").length ?? 0).toBe(3);
    expect(inner()).toBe(1);
    await userEvent.keyboard("{Escape}");
    await expect.poll(host).toBeNull();
  });
});
