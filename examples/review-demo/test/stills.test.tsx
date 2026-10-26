import { mountPage } from "@henrikkvamme/blueline";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Lift } from "../../../src/part/lift";
import type { BluelineConfig, ConfigStep, ConfigVariant } from "@henrikkvamme/blueline/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

/*
 * `v` on a step whose variants change the page, and not a part, on a page with no React:
 * Blueline shows each variant in turn, copies the step's target, goes back to the variant the
 * step keeps, and lifts the copies. Each variant puts a class on the body that the page's CSS
 * reads.
 */

const LOOKS = { Table: "rgb(0, 0, 200)", Cards: "rgb(200, 0, 0)", List: "rgb(0, 128, 0)" };
type Look = keyof typeof LOOKS;

let style: HTMLStyleElement | undefined;
/** The variants the page was asked to show, in order. */
let shows: string[] = [];

afterEach(async () => {
  window.blueline?.dispose();
  await vi.waitFor(() => expect(document.querySelector("blueline-tools")).toBeNull());
  document.body.replaceChildren();
  document.body.className = "";
  style?.remove();
  localStorage.clear();
  sessionStorage.clear();
  shows = [];
  vi.restoreAllMocks();
});

/** The page: a card the body's class colours, the step's target. */
function page() {
  style = document.createElement("style");
  style.textContent = Object.entries(LOOKS)
    .map(([look, color]) => `body.${look} .card { color: ${color} !important; }`)
    .join("\n");
  document.head.append(style);
  const at = document.createElement("main");
  at.innerHTML = '<div id="target" class="card" style="width: 160px; padding: 8px">Rows</div>';
  document.body.append(at);
}

const showing = (look: Look, more: Partial<ConfigVariant> = {}): ConfigVariant => ({
  label: look,
  show: async () => {
    shows.push(look);
    document.body.className = look;
  },
  ...more,
});

const step = (id: string, more: Partial<ConfigStep> = {}): ConfigStep => ({
  id,
  title: `Step ${id}`,
  look: "The rows",
  group: "Group",
  target: ["#target"],
  variants: [showing("Table"), showing("Cards"), showing("List")],
  ...more,
});

function walk(config: BluelineConfig, journey = "j") {
  page();
  mountPage({ storageKey: "stills.review", config });
  window.blueline?.start(journey);
}

const configOf = (...steps: readonly ConfigStep[]): BluelineConfig => ({
  journeys: [
    { id: "j", title: "Journey", steps },
    { id: "k", title: "Other", steps: [{ id: "k1", title: "Step k1", look: "", group: "Group" }] },
  ],
});

const lift = () => document.querySelector("blueline-lift")?.shadowRoot ?? null;
const dialog = () => lift()?.querySelector('[role="dialog"]') ?? null;
const status = () => lift()?.querySelector('[role="status"]')?.textContent ?? "";
/** The copies the lift shows: each slot's holder, in a shadow root of its own. */
const holders = () => [...(document.querySelector("blueline-lift")?.children ?? [])];
const colorIn = (holder: Element) => {
  const card = holder.shadowRoot?.querySelector("div > div");
  return card === null || card === undefined ? "" : getComputedStyle(card).color;
};
const ready = async () => {
  await vi.waitFor(() =>
    expect(document.documentElement.getAttribute("data-blueline")).toBe("step"),
  );
  await vi.waitFor(() => expect(shows).toContain("Table"));
};
/** The lift is up with its copies. */
const lifted = () =>
  vi.waitFor(
    () => {
      expect(dialog()?.getAttribute("aria-label")).toBe("Variants and states of Step a");
      expect(holders().length).toBeGreaterThanOrEqual(3);
    },
    { timeout: 5000 },
  );
const down = () =>
  vi.waitFor(() => {
    expect(document.querySelector("blueline-lift")).toBeNull();
  });

describe("the lift of a step's own variants", () => {
  it("copies each variant, puts the page back, and shows each copy with its look", async () => {
    walk(configOf(step("a")));
    await ready();
    await userEvent.keyboard("v");
    await lifted();
    expect(shows).toEqual(["Table", "Cards", "List", "Table"]);
    expect(document.body.className).toBe("Table");
    const colors = new Set(holders().map(colorIn));
    expect(colors).toEqual(new Set(Object.values(LOOKS)));
    // The page's queries do not find the copies.
    expect(document.querySelectorAll(".card, #target")).toHaveLength(1);
  });

  it("puts the chosen variant on the page with Use, and the settle keeps it", async () => {
    walk(configOf(step("a")));
    await ready();
    await userEvent.keyboard("v");
    await lifted();
    await userEvent.keyboard("l");
    await userEvent.keyboard("{Enter}");
    await down();
    expect(document.body.className).toBe("Cards");
    const tools = document.querySelector("blueline-tools")?.shadowRoot;
    await vi.waitFor(() => expect(tools?.textContent).toContain("Keep Cards"));
  });

  it("keeps the page on the first variant with Close, and switches nothing", async () => {
    walk(configOf(step("a")));
    await ready();
    await userEvent.keyboard("v");
    await lifted();
    const before = shows.length;
    await userEvent.keyboard("{Escape}");
    await down();
    expect(shows).toHaveLength(before);
    expect(document.body.className).toBe("Table");
  });

  it("stops at once on Esc while a variant's show has not ended, and goes back", async () => {
    const never = showing("Cards", {
      show: (signal) =>
        new Promise<void>((_, fail) => {
          document.body.className = "Cards";
          signal.addEventListener("abort", () => fail(new Error("aborted")));
        }),
    });
    walk(configOf(step("a", { variants: [showing("Table"), never, showing("List")] })));
    await ready();
    await userEvent.keyboard("v");
    await vi.waitFor(() => expect(status()).toContain("Copying Cards"));
    await userEvent.keyboard("{Escape}");
    await down();
    await vi.waitFor(() => expect(document.body.className).toBe("Table"), { timeout: 1000 });
    expect(holders()).toHaveLength(0);
  });

  it("stops at once on Esc while a variant's ready has not ended", async () => {
    walk(
      configOf(
        step("a", {
          ready: (signal) =>
            document.body.className === "Cards"
              ? new Promise<void>((_, fail) =>
                  signal.addEventListener("abort", () => fail(new Error("aborted"))),
                )
              : Promise.resolve(),
        }),
      ),
    );
    await ready();
    await userEvent.keyboard("v");
    await vi.waitFor(() => expect(status()).toContain("Copying Cards"));
    await userEvent.keyboard("{Escape}");
    await down();
    await vi.waitFor(() => expect(document.body.className).toBe("Table"), { timeout: 1000 });
  });

  it("opens no lift when the walk goes to another step while it copies", async () => {
    const slow = showing("Cards", {
      show: async () => {
        document.body.className = "Cards";
        await new Promise((done) => setTimeout(done, 300));
      },
    });
    walk(configOf(step("a", { variants: [showing("Table"), slow] }), step("b")));
    await ready();
    await userEvent.keyboard("v");
    await vi.waitFor(() => expect(status()).toContain("Copying Cards"));
    window.blueline?.start("j", "b");
    await down();
    await new Promise((done) => setTimeout(done, 500));
    expect(document.querySelector("blueline-lift")).toBeNull();
    // Back on a, the step shows the variant it keeps.
    shows = [];
    window.blueline?.start("j", "a");
    await vi.waitFor(() => expect(shows).toEqual(["Table"]));
    expect(document.body.className).toBe("Table");
  });

  it("opens no lift when another journey starts while it copies", async () => {
    const slow = showing("Cards", {
      show: async () => {
        document.body.className = "Cards";
        await new Promise((done) => setTimeout(done, 300));
      },
    });
    walk(configOf(step("a", { variants: [showing("Table"), slow] })));
    await ready();
    await userEvent.keyboard("v");
    await vi.waitFor(() => expect(status()).toContain("Copying Cards"));
    window.blueline?.start("k");
    await down();
    await new Promise((done) => setTimeout(done, 500));
    expect(document.querySelector("blueline-lift")).toBeNull();
    shows = [];
    window.blueline?.start("j", "a");
    await vi.waitFor(() => expect(shows).toEqual(["Table"]));
  });

  it("stops when a variant fails, says why until it is closed, and goes back", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const broken = showing("Cards", {
      show: async () => {
        throw new Error("no cards");
      },
    });
    walk(configOf(step("a", { variants: [showing("Table"), broken, showing("List")] })));
    await ready();
    await userEvent.keyboard("v");
    await vi.waitFor(() => expect(status()).toContain("no cards"));
    expect(document.body.className).toBe("Table");
    expect(shows).not.toContain("List");
    await userEvent.keyboard("{Escape}");
    await down();
  });
  it("leaves nothing behind when the tools go while it copies", async () => {
    const slow = showing("Cards", {
      show: async () => {
        document.body.className = "Cards";
        await new Promise((done) => setTimeout(done, 300));
      },
    });
    walk(configOf(step("a", { variants: [showing("Table"), slow] })));
    await ready();
    await userEvent.keyboard("v");
    await vi.waitFor(() => expect(status()).toContain("Copying"));
    window.blueline?.dispose();
    await vi.waitFor(() => expect(document.querySelector("blueline-tools")).toBeNull());
    mountPage({ storageKey: "stills.review", config: configOf(step("a")) });
    await new Promise((done) => setTimeout(done, 800));
    expect(document.querySelector("blueline-lift")).toBeNull();
  });

  it("says so when the first variant does not come back", async () => {
    let tables = 0;
    const once = showing("Table", {
      show: async () => {
        shows.push("Table");
        tables += 1;
        if (tables > 1) throw new Error("no table");
        document.body.className = "Table";
      },
    });
    walk(configOf(step("a", { variants: [once, showing("Cards")] })));
    await ready();
    await userEvent.keyboard("v");
    await vi.waitFor(() => expect(status()).toContain("Table did not come back"));
    expect(holders()).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await down();
  });

  it("keeps the variant chosen while the page takes a while to show it", async () => {
    let slow = false;
    const cards = showing("Cards", {
      show: async () => {
        shows.push("Cards");
        document.body.className = "Cards";
        if (slow) await new Promise((done) => setTimeout(done, 400));
      },
    });
    walk(configOf(step("a", { variants: [showing("Table"), cards, showing("List")] })));
    await ready();
    await userEvent.keyboard("v");
    await lifted();
    slow = true;
    await userEvent.keyboard("l");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("l");
    // While it lands, the lift still shows Cards in the middle, as the page will.
    expect(lift()?.querySelector('[aria-label="Use Cards"]')).not.toBeNull();
    expect(lift()?.querySelector('[aria-label="Use List"]')).toBeNull();
    await down();
    expect(document.body.className).toBe("Cards");
    const tools = document.querySelector("blueline-tools")?.shadowRoot;
    await vi.waitFor(() => expect(tools?.textContent).toContain("Keep Cards"));
  });
});

describe("the lift, under React's StrictMode", () => {
  it("puts the part down once the page shows the variant chosen", async () => {
    const at = document.createElement("div");
    document.body.append(at);
    const root = createRoot(at);
    const done = vi.fn();
    root.render(
      <StrictMode>
        <Lift
          id="strict"
          title="the rows"
          variants={["Table", "Cards"]}
          states={["As it is"]}
          start={{ variant: "Table", state: 0 }}
          from={new DOMRect(0, 0, 100, 40)}
          hug={false}
          onDrop={undefined}
          onUndo={() => undefined}
          onNote={undefined}
          note={undefined}
          noted={[]}
          onPut={() => Promise.resolve()}
          where={() => new DOMRect(0, 0, 100, 40)}
          onDone={done}
        />
      </StrictMode>,
    );
    await vi.waitFor(() =>
      expect(lift()?.querySelector('[aria-label="Use Table"]')).not.toBeNull(),
    );
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    root.unmount();
  });
});
