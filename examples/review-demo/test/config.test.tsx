import { mountPage } from "@henrikkvamme/blueline";
import type { BluelineConfig, ConfigStep } from "@henrikkvamme/blueline/config";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

/*
 * An app's journeys as a config, on a page the overlay mounts by itself: the config's
 * actions on the page, the order of a step's phases, and the reason the panel shows when a
 * phase fails. The page has no React but where a test says so.
 */

/** The tools' shadow root. */
const tools = () => document.querySelector("blueline-tools")?.shadowRoot ?? null;
/** The tools' words, in one line. */
const words = () => (tools()?.textContent ?? "").replace(/\s+/g, " ");
/** The marks that say why a step failed, on the bar and the tree's rows. */
const marks = (reason: string) => tools()?.querySelectorAll(`[aria-label="${reason}"]`).length ?? 0;
/** Shows the panel, as the reviewer does with Ctrl+B. */
const showPanel = () => userEvent.keyboard("{Control>}b{/Control}");

const step = (id: string, more: Partial<ConfigStep> = {}): ConfigStep => ({
  id,
  title: `Step ${id}`,
  look: "The part",
  group: "Group",
  ...more,
});

const configOf = (...steps: readonly ConfigStep[]): BluelineConfig => ({
  journeys: [{ id: "j", title: "Journey", steps }],
});

/** Mounts the overlay with the config and starts its journey. */
function walk(config: unknown) {
  const tools = mountPage({ storageKey: "config.review", config });
  tools?.start("j");
  return tools;
}

const walking = () => document.documentElement.getAttribute("data-blueline") === "step";

let root: Root | undefined;
afterEach(async () => {
  window.blueline?.dispose();
  root?.unmount();
  root = undefined;
  await vi.waitFor(() => expect(document.querySelector("blueline-tools")).toBeNull());
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

/** Puts the HTML on the page. */
const page = (html: string) => {
  const at = document.createElement("main");
  at.innerHTML = html;
  document.body.append(at);
  return at;
};

describe("a config's actions", () => {
  it("click, type, wait and emit, each on its element once it is there", async () => {
    page('<button id="open">Open</button><input id="name" />');
    const heard: string[] = [];
    document.querySelector("#open")?.addEventListener("click", () => {
      // The panel comes a while after the click, as an app draws it.
      setTimeout(() => page('<section id="panel"></section>'), 50);
    });
    document.querySelector("#name")?.addEventListener("input", (e) => {
      if (e.target instanceof HTMLInputElement) heard.push(`input ${e.target.value}`);
    });
    document.querySelector("#name")?.addEventListener("change", () => heard.push("change"));
    window.addEventListener("picked", (e) => {
      if (e instanceof CustomEvent) heard.push(`picked ${String(e.detail)}`);
    });
    walk(
      configOf(
        step("a", {
          enter: [{ click: "#open" }, { wait: "#panel" }],
          setup: [
            { type: "Ada", into: "#name" },
            { emit: "picked", detail: 7 },
          ],
          ready: ["#panel"],
        }),
      ),
    );
    await vi.waitFor(() => expect(heard).toEqual(["input Ada", "change", "picked 7"]));
    expect(document.activeElement).toBe(document.querySelector("#name"));
    expect(words()).not.toContain("failed");
  });

  it("says what a wait waited for when it is too late, and drops it once the step opens", async () => {
    const reason = "setup failed: no element matches #late in 0.2 s";
    // The console keeps the cause.
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    walk(configOf(step("a", { timeout: 200, setup: [{ wait: "#late" }] }), step("b")));
    // The bar marks the step, and the panel's step says why.
    await vi.waitFor(() => expect(marks(reason)).toBe(1));
    await showPanel();
    await vi.waitFor(() => expect(words()).toContain(reason));
    page('<p id="late"></p>');
    window.blueline?.start("j", "b");
    window.blueline?.start("j", "a");
    await vi.waitFor(() => expect(words()).not.toContain("setup failed"));
    expect(marks(reason)).toBe(0);
    expect(String(logged.mock.calls[0])).toContain("no element matches #late");
  });

  it("fails a function that never ends, with its reason on the bar and the step", async () => {
    walk(configOf(step("a", { timeout: 200, ready: () => new Promise(() => undefined) })));
    const reason = "ready failed: the function did not end in 0.2 s";
    // The console keeps the cause.
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await vi.waitFor(() => expect(marks(reason)).toBe(1));
    await showPanel();
    await vi.waitFor(() => expect(words()).toContain(reason));
    expect(String(logged.mock.calls[0])).toContain("the function did not end");
  });

  it("press runs the app's key handler, Enter submits a form, and Blueline's keys pass it by", async () => {
    page('<form><input id="q" /></form>');
    const keys: string[] = [];
    let submitted = 0;
    document.querySelector("#q")?.addEventListener("keydown", (e) => {
      if (e instanceof KeyboardEvent) keys.push(`${e.shiftKey ? "Shift+" : ""}${e.key}`);
    });
    document.querySelector("form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      submitted += 1;
    });
    walk(
      configOf(
        step("a", {
          setup: [
            { press: "Escape", on: "#q" },
            { press: "j", on: "#q", shift: true },
            { press: "Enter", on: "#q" },
          ],
        }),
      ),
    );
    await vi.waitFor(() => expect(submitted).toBe(1));
    expect(keys).toEqual(["Escape", "Shift+j", "Enter"]);
    // Escape on the page leaves the step; the action's Escape does not.
    expect(walking()).toBe(true);
  });

  it("does not submit when the app's handler stopped Enter", async () => {
    page('<form><input id="q" /></form>');
    let submitted = 0;
    document.querySelector("#q")?.addEventListener("keydown", (e) => e.preventDefault());
    document.querySelector("form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      submitted += 1;
    });
    walk(configOf(step("a", { setup: [{ press: "Enter", on: "#q" }], ready: ["#q"] })));
    await vi.waitFor(() => expect(walking()).toBe(true));
    await new Promise((done) => setTimeout(done, 100));
    expect(submitted).toBe(0);
  });
});

describe("a config's step", () => {
  it("shows a variant again from its start when the page draws its target again", async () => {
    const at = page('<button id="show">Show</button>');
    const shown: string[] = [];
    document.querySelector("#show")?.addEventListener("click", () => {
      at.querySelector("#part")?.remove();
      at.insertAdjacentHTML("beforeend", '<div id="part"><button id="two">Two</button></div>');
      at.querySelector("#two")?.addEventListener("click", () => shown.push("Two"));
    });
    walk(
      configOf(
        step("a", {
          target: ["#part"],
          setup: [{ click: "#show" }],
          variants: [{ label: "Two", show: [{ click: "#two" }] }],
          ready: ["#part"],
        }),
      ),
    );
    await vi.waitFor(() => expect(shown).toEqual(["Two"]));
    at.querySelector("#part")?.remove();
    await vi.waitFor(() => expect(shown).toEqual(["Two", "Two"]), { timeout: 3000 });
    expect(at.querySelector("#part")).not.toBeNull();
  });

  it("is not used when the config breaks a rule: the tree and the console say why", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    walk(configOf(step("a"), step("a")));
    await showPanel();
    // The test's page is as narrow as a phone's, where the tree starts folded.
    const unfold = await vi.waitFor(() => {
      const button = tools()?.querySelector<HTMLButtonElement>(
        'button[aria-label="Pages and journeys"]',
      );
      if (button == null) throw new Error("No tree line yet");
      return button;
    });
    unfold.click();
    await vi.waitFor(() =>
      expect(words()).toContain("The config is not used: Two steps have the ID a"),
    );
    expect(error).toHaveBeenCalledWith("Blueline does not use the config: Two steps have the ID a");
  });
});

describe("a config's actions on a React page", () => {
  function Form() {
    const [name, setName] = useState("");
    const [count, setCount] = useState(0);
    return (
      <>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        <button id="again" type="button" onClick={() => setCount((c) => c + 1)}>
          {count}
        </button>
        <output id="said">{name}</output>
      </>
    );
  }

  it("types into a field React controls, and the component keeps it when it draws again", async () => {
    const at = document.createElement("div");
    document.body.append(at);
    root = createRoot(at);
    root.render(<Form />);
    await vi.waitFor(() => expect(document.querySelector("#name")).not.toBeNull());
    walk(configOf(step("a", { setup: [{ type: "Ada", into: "#name" }, { click: "#again" }] })));
    await vi.waitFor(() => expect(document.querySelector("#again")?.textContent).toBe("1"));
    expect(document.querySelector("#said")?.textContent).toBe("Ada");
    expect(document.querySelector<HTMLInputElement>("#name")?.value).toBe("Ada");
  });
});
