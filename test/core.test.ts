import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focused, targetOf } from "../src/core/root";
import { startSession, type Session } from "../src/core/session";
import type { DevAdapter } from "../src/types";

const SRC = path.join(import.meta.dirname, "..", "src");

/** The core: the session and what it runs, with no view. */
const CORE = ["core", "session", "keys", "io", "notes"];
const CORE_FILES = ["part/store.ts", "part/page.ts", "part/merge.ts", "part/lift-actions.ts"];

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

describe("the core", () => {
  it("imports nothing of React and nothing of the view", () => {
    const files = [
      ...CORE.flatMap((d) => filesIn(path.join(SRC, d))),
      ...CORE_FILES.map((f) => path.join(SRC, f)),
    ];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      expect(file.endsWith(".tsx"), file).toBe(false);
      const imports = [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      for (const from of imports) {
        expect(from, `${file} imports ${String(from)}`).not.toMatch(
          /^(react|react-dom|@xstate\/react)(\/|$)|\/ui\/|\.tsx$|\/choices$/,
        );
      }
    }
  });
});

describe("a session", () => {
  const kept = new Map<string, string>();
  let address = "";
  let session: Session | undefined;

  beforeEach(() => {
    kept.clear();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (k: string) => kept.get(k) ?? null,
        setItem: (k: string, v: string) => void kept.set(k, v),
      },
      location: {
        get href() {
          return address;
        },
        pathname: "/",
      },
      history: {
        state: null,
        replaceState: (_: unknown, __: string, to: string) => (address = to),
      },
    });
  });
  afterEach(() => session?.dispose());

  const step = (id: string) => ({
    id,
    title: id,
    look: "",
    group: { id: "g", title: "G" },
  });
  const adapter: DevAdapter<null> = {
    journeys: [{ id: "prep", title: "Prep", steps: [step("a"), step("b"), step("c")] }],
    enter: () => Effect.succeed(null),
    context: () => null,
  };
  const start = () => startSession({ adapter, storageKey: "test", path: () => "/" });

  it("starts the review a link names, on its step, and takes the link out of the address", () => {
    address = "http://localhost/?review=prep&step=b";
    session = start();
    const { context } = session.actor.getSnapshot();
    expect(context).toMatchObject({ active: true, journey: "prep", at: 1 });
    expect(address).toBe("http://localhost/");
  });

  it("follows a link when the kept review is on a step that opens another page", () => {
    kept.set("test", JSON.stringify({ journey: "prep", active: true, at: 2 }));
    address = "http://localhost/?review=prep&step=a";
    const opened: string[] = [];
    const moving: DevAdapter<null> = {
      ...adapter,
      // The step's page opens at once, as a router's push does.
      enter: (s) => {
        opened.push(s.id);
        address = `http://localhost/${s.id}`;
        return null;
      },
    };
    session = startSession({ adapter: moving, storageKey: "test", path: () => "/" });
    expect(session.actor.getSnapshot().context).toMatchObject({ active: true, at: 0 });
    expect(opened).toEqual(["a"]);
  });

  it("keeps the kept review for a link to a journey the app does not have", () => {
    kept.set("test", JSON.stringify({ journey: "prep", active: true, at: 1 }));
    address = "http://localhost/?review=missing";
    session = start();
    expect(session.actor.getSnapshot().context).toMatchObject({ active: true, at: 1 });
  });

  it("follows a link the app goes to after the session started", () => {
    address = "http://localhost/";
    session = startSession({
      adapter,
      storageKey: "test",
      path: () => new URL(address).pathname,
    });
    address = "http://localhost/other?review=prep&step=b";
    session.moved();
    expect(session.actor.getSnapshot().context).toMatchObject({ active: true, at: 1 });
    expect(address).toBe("http://localhost/other");
  });

  it("starts idle with no link, and keeps the review in the browser's storage", () => {
    address = "http://localhost/";
    session = start();
    expect(session.actor.getSnapshot().context.active).toBe(false);
    expect(session.info().journeys.map((j) => j.id)).toEqual(["prep", "page"]);
    session.actor.send({ type: "start", journey: "prep", at: 2, fresh: false });
    expect(JSON.parse(kept.get("test") ?? "{}")).toMatchObject({ active: true, at: 2 });
  });

  it("starts a review by the journey's and the step's IDs", () => {
    address = "http://localhost/";
    session = start();
    expect(session.start("gone")).toBe(false);
    expect(session.actor.getSnapshot().context.active).toBe(false);
    expect(session.start("prep", "c")).toBe(true);
    expect(session.actor.getSnapshot().context).toMatchObject({ active: true, at: 2 });
    // A step the journey does not have: its first.
    session.start("prep", "gone");
    expect(session.actor.getSnapshot().context.at).toBe(0);
  });

  it("starts again where it was after it is disposed", () => {
    address = "http://localhost/";
    session = start();
    session.start("prep", "b");
    session.dispose();
    session = start();
    expect(session.actor.getSnapshot().context).toMatchObject({ active: true, at: 1 });
  });

  it("stops the machine when it is disposed", () => {
    address = "http://localhost/";
    session = start();
    session.dispose();
    expect(session.actor.getSnapshot().status).toBe("stopped");
    session = undefined;
  });
});

describe("the tools' root", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads an event's start through a shadow root, from a DOM event or React's", () => {
    const inner = { name: "inner" };
    const native = { composedPath: () => [inner], target: { name: "host" } } as unknown as Event;
    expect(targetOf(native)).toBe(inner);
    expect(targetOf({ nativeEvent: native })).toBe(inner);
  });

  it("follows the focus into a shadow root", () => {
    const field = { shadowRoot: null };
    const host = { shadowRoot: { activeElement: field } };
    vi.stubGlobal("document", { activeElement: host });
    expect(focused()).toBe(field);
    vi.stubGlobal("document", { activeElement: field });
    expect(focused()).toBe(field);
  });
});
