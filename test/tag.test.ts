import { afterEach, describe, expect, it, vi } from "vitest";
import { tagModule } from "../src/server/tag.ts";

const asModule = (text: string) => `data:text/javascript,${encodeURIComponent(text)}`;

/** The page the tag runs on: still loading, with its load and idle moments in the test's hand. */
function loadingPage() {
  const mounted: unknown[] = [];
  const onLoad: (() => void)[] = [];
  const onIdle: (() => void)[] = [];
  vi.stubGlobal("document", { readyState: "loading" });
  vi.stubGlobal("addEventListener", (type: string, run: () => void) => {
    if (type === "load") onLoad.push(run);
  });
  vi.stubGlobal("requestIdleCallback", (run: () => void) => onIdle.push(run));
  vi.stubGlobal("bluelineMounted", mounted);
  const overlay = asModule(
    "export const mountPage = (options) => globalThis.bluelineMounted.push(options);",
  );
  return { mounted, onLoad, onIdle, overlay };
}

const tick = () => new Promise((done) => setTimeout(done, 10));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the overlay's tag", () => {
  it("loads the overlay only after the page's load, at an idle moment", async () => {
    const { mounted, onLoad, onIdle, overlay } = loadingPage();
    const page = { storageKey: "blueline", routes: {} };
    const ran = import(/* @vite-ignore */ asModule(tagModule({ overlay, page })));
    await tick();
    expect(mounted).toEqual([]);
    expect(onIdle).toHaveLength(0);
    for (const run of onLoad) run();
    await tick();
    expect(mounted).toEqual([]);
    for (const run of onIdle) run();
    await ran;
    expect(mounted).toEqual([page]);
  });
});
