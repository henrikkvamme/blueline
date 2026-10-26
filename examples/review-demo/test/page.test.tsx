import { mount, mountPage, type DevAdapter } from "@henrikkvamme/blueline";
import { DevTools } from "@henrikkvamme/blueline/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The overlay that a script tag or the Vite plugin mounts by itself, beside the app's own:
 * the app's tools come first, whichever loads first.
 */

const adapter: DevAdapter<void> = {
  journeys: [],
  context: () => undefined,
  enter: () => undefined,
};

const hosts = () => document.querySelectorAll("blueline-tools").length;

describe("an automatic overlay", () => {
  let root: Root | undefined;

  afterEach(async () => {
    root?.unmount();
    root = undefined;
    window.blueline?.dispose();
    await vi.waitFor(() => expect(hosts()).toBe(0));
    localStorage.clear();
  });

  function render() {
    const at = document.createElement("div");
    document.body.append(at);
    root = createRoot(at);
    root.render(<DevTools adapter={adapter} storageKey="app.review" />);
  }

  it("leaves the app's mount", () => {
    const app = mount({ adapter, storageKey: "app.review" });
    expect(mountPage({ storageKey: "page.review" })).toBeUndefined();
    expect(window.blueline).toBe(app);
    expect(hosts()).toBe(1);
  });

  it("leaves the app's <DevTools>", async () => {
    render();
    await vi.waitFor(() => expect(hosts()).toBe(1));
    expect(mountPage({ storageKey: "page.review" })).toBeUndefined();
    expect(hosts()).toBe(1);
  });

  it("gives way to the app's mount that comes after it", async () => {
    const page = mountPage({ storageKey: "page.review" });
    expect(page).toBeDefined();
    const app = mount({ adapter, storageKey: "app.review" });
    await vi.waitFor(() => expect(hosts()).toBe(1));
    expect(window.blueline).toBe(app);
  });

  it("gives way to the app's <DevTools> that comes after it", async () => {
    expect(mountPage({ storageKey: "page.review" })).toBeDefined();
    render();
    await vi.waitFor(() => expect(window.blueline).toBeUndefined());
    await vi.waitFor(() => expect(hosts()).toBe(1));
  });
});
