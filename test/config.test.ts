import { describe, expect, it } from "vitest";
import type { BluelineConfig, ConfigStep } from "../src/config";
import { checkConfig } from "../src/config/rules";

/*
 * The rules a config keeps, and the reason the page shows when it breaks one.
 */

const step = (id: string, more: Partial<ConfigStep> = {}): ConfigStep => ({
  id,
  title: `Step ${id}`,
  look: "The part",
  group: "Group",
  ...more,
});

const config = (...steps: readonly ConfigStep[]): BluelineConfig => ({
  journeys: [{ id: "j", title: "Journey", steps }],
});

/** A config from plain JavaScript, which the types do not check. */
const loose = (...steps: readonly unknown[]): unknown => ({
  journeys: [{ id: "j", title: "Journey", steps }],
});

/** The reason the config is not used, or `ok`. */
const reason = (value: unknown) => {
  const checked = checkConfig(value);
  return checked.kind === "ok" ? "ok" : checked.reason;
};

describe("a config's rules", () => {
  it("takes journeys with actions, code and variants", () => {
    expect(
      reason(
        config(
          step("a", {
            enter: [{ open: "/list" }, { click: "#first" }],
            setup: [
              { type: "Ada", into: "input" },
              { press: "Enter", shift: true },
            ],
            reset: () => undefined,
            exit: [{ emit: "closed", detail: { by: "walk" } }],
            ready: ["#panel"],
            timeout: 2000,
            variants: [
              { label: "One", show: [{ wait: ".one" }] },
              { label: "Two", choice: ["x", "y"] },
            ],
          }),
        ),
      ),
    ).toBe("ok");
  });

  it("needs journeys", () => {
    expect(reason(undefined)).toContain("needs journeys");
    expect(reason({ journeys: {} })).toContain("needs journeys");
  });

  it("refuses two journeys or two steps with one ID, also across journeys", () => {
    expect(
      reason({
        journeys: [
          { id: "j", title: "A", steps: [] },
          { id: "j", title: "B", steps: [] },
        ],
      }),
    ).toBe("Two journeys have the ID j");
    expect(
      reason({
        journeys: [
          { id: "a", title: "A", steps: [step("s")] },
          { id: "b", title: "B", steps: [step("s")] },
        ],
      }),
    ).toBe("Two steps have the ID s");
  });

  it("keeps the page's own review's IDs for it", () => {
    for (const id of ["page", "page:header", "place:/home"]) {
      expect(reason({ journeys: [{ id, title: "J", steps: [] }] })).toContain("page's own review");
      expect(reason(config(step(id)))).toContain("page's own review");
    }
    expect(reason(config(step("pages")))).toBe("ok");
  });

  it("takes open only as the first action of enter", () => {
    expect(reason(config(step("a", { enter: [{ click: "a" }, { open: "/" }] })))).toBe(
      "The step a's enter's action 2: open may only be the first action of enter",
    );
    expect(reason(config(step("a", { setup: [{ open: "/" }] })))).toContain("open may only");
    expect(
      reason(config(step("a", { variants: [{ label: "One", show: [{ open: "/" }] }] }))),
    ).toContain("open may only");
  });

  it("refuses two variants with one label in a step", () => {
    expect(reason(config(step("a", { variants: [{ label: "One" }, { label: "One" }] })))).toBe(
      "The step a has two variants labelled One",
    );
  });

  it("says which action is not one, and what an action does not take", () => {
    expect(reason(loose({ ...step("a"), setup: [{ tap: "a" }] }))).toContain(
      "needs one of open, click, type, press, wait, emit",
    );
    expect(reason(loose({ ...step("a"), setup: [{ click: "a", wait: "b" }] }))).toContain(
      "needs one of",
    );
    expect(reason(loose({ ...step("a"), setup: [{ click: "a", into: "b" }] }))).toBe(
      "The step a's setup's action 1 has into, which click does not take",
    );
    expect(reason(loose({ ...step("a"), setup: [{ type: "x" }] }))).toContain("needs into");
  });

  it("needs a step's words, a timeout above 0 and ready as selectors or code", () => {
    expect(reason(loose({ ...step("a"), look: 1 }))).toContain("needs look");
    expect(reason(config(step("a", { timeout: 0 })))).toContain("timeout");
    expect(reason(loose({ ...step("a"), ready: [1] }))).toContain("ready");
  });
});
