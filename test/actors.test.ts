import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActor, type EventFrom, initialTransition, transition, waitFor } from "xstate";
import { handoffId } from "../src/notes/handoff";
import { listedJourneys, PAGE_JOURNEY, pageJourney, pageParts } from "../src/part/page";
import { parts } from "../src/part/store";
import { liveMachine, shapesOf } from "../src/session/actors";
import { postedLine } from "../src/session/lines";
import { sessionMachine, stepNoteId } from "../src/session/machine";
import { START } from "../src/session/state";
import type { DevAdapter, DevJourney, DevStep } from "../src/types";

/** A journey whose code says what it does, in order. */
function journey(log: string[]): DevJourney<string> {
  const said = (what: string) => () => Effect.sync(() => void log.push(what));
  const step = (id: string, variants: readonly string[]): DevStep<string> => ({
    id,
    title: `Step ${id}`,
    look: "",
    group: { id: "g", title: "Group" },
    setup: said(`setup ${id}`),
    reset: said(`reset ${id}`),
    variants: variants.map((label) => ({ label, apply: said(`apply ${id} ${label}`) })),
  });
  return { id: "prep", title: "Prep", steps: [step("a", []), step("b", ["One", "Two"])] };
}

function walk() {
  const log: string[] = [];
  const shifts: (string | undefined)[] = [];
  const adapter: DevAdapter<string> = {
    journeys: [journey(log)],
    context: () => "page",
    enter: (step, { show }) =>
      Effect.sync(() => {
        show({ title: step.title, busy: false });
        log.push(`enter ${step.id}`);
        return "world";
      }),
  };
  const machine = liveMachine({ adapter, shift: (s) => shifts.push(s?.title) });
  const actor = createActor(machine, {
    input: { kept: { ...START, journey: "prep" }, journeys: shapesOf(adapter.journeys), now: 0 },
  });
  return { actor, log, shifts };
}

describe("the walk on a page", () => {
  it("opens a step, shows its variant, and leaves the step before clean", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { actor, log, shifts } = walk();
        const ready = (at: number) =>
          Effect.promise(() =>
            waitFor(actor, (s) => s.matches({ review: { on: "ready" } }) && s.context.at === at, {
              timeout: 3000,
            }),
          );
        actor.start();
        actor.send({ type: "choose" });
        yield* ready(0);
        actor.send({ type: "go", by: 1 });
        yield* ready(1);
        actor.stop();
        // Each variant: reset, setup, the variant; leaving a: its reset.
        expect(log).toEqual([
          "enter a",
          "reset a",
          "setup a",
          "reset a",
          "enter b",
          "reset b",
          "setup b",
          "apply b One",
        ]);
        expect(shifts.at(-1)).toBeUndefined();
      }),
    ));
});

/** A walk whose app gives Promises, each held until the test lets it end. */
function promised() {
  const log: string[] = [];
  const held = new Map<string, { readonly end: () => void; readonly signal: AbortSignal }>();
  const shifts: (string | undefined)[] = [];
  const shows = new Map<string, (title: string) => void>();
  const hold = (what: string, signal: AbortSignal) =>
    new Promise<void>((end) => {
      log.push(what);
      held.set(what, { end, signal });
    });
  const step = (id: string): DevStep<string> => ({
    id,
    title: `Step ${id}`,
    look: "",
    group: { id: "g", title: "Group" },
    setup: (_, signal) => hold(`setup ${id}`, signal).then(() => void log.push(`set ${id}`)),
    variants: [
      { label: "One", apply: () => void log.push(`apply ${id}`) },
      { label: "Two", apply: () => void log.push(`apply ${id} Two`) },
    ],
  });
  const adapter: DevAdapter<string> = {
    journeys: [{ id: "prep", title: "Prep", steps: [step("a"), step("b")] }],
    context: () => "page",
    enter: (s, { signal, show }) => {
      shows.set(s.id, (title) => show({ title, busy: true }));
      return hold(`enter ${s.id}`, signal).then(() => "world");
    },
  };
  const actor = createActor(liveMachine({ adapter, shift: (s) => shifts.push(s?.title) }), {
    input: { kept: { ...START, journey: "prep" }, journeys: shapesOf(adapter.journeys), now: 0 },
  });
  /** Lets the held Promise end, once the walk holds it. */
  const end = (what: string) =>
    Effect.promise(async () => {
      await vi.waitFor(() => expect(held.has(what)).toBe(true));
      const it = held.get(what);
      it?.end();
      return it?.signal;
    });
  return { actor, log, end, shifts, shows };
}

const readyAt = (actor: ReturnType<typeof promised>["actor"], at: number) =>
  Effect.promise(() =>
    waitFor(actor, (s) => s.matches({ review: { on: "ready" } }) && s.context.at === at, {
      timeout: 3000,
    }),
  );

describe("an app that gives Promises", () => {
  it("drops a step's late result when the walk went on, and aborts its signal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { actor, log, end } = promised();
        actor.start();
        actor.send({ type: "choose" });
        yield* Effect.promise(() => vi.waitFor(() => expect(log).toContain("enter a")));
        actor.send({ type: "go", by: 1 });
        const late = yield* end("enter a");
        yield* end("enter b");
        yield* end("setup b");
        yield* readyAt(actor, 1);
        actor.stop();
        expect(late?.aborted).toBe(true);
        expect(log).toEqual(["enter a", "enter b", "setup b", "set b", "apply b"]);
      }),
    ));

  it("shows nothing more of a step the walk left", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { actor, log, shifts, shows } = promised();
        actor.start();
        actor.send({ type: "choose" });
        yield* Effect.promise(() => vi.waitFor(() => expect(log).toContain("enter a")));
        actor.send({ type: "go", by: 1 });
        yield* Effect.promise(() => vi.waitFor(() => expect(log).toContain("enter b")));
        shows.get("b")?.("b");
        shows.get("a")?.("late a");
        actor.stop();
        expect(shifts).not.toContain("late a");
        expect(shifts.filter((s) => s !== undefined).at(-1)).toBe("b");
      }),
    ));

  it("drops a setup that ends after the reviewer left the review", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { actor, log, end } = promised();
        actor.start();
        actor.send({ type: "choose" });
        yield* end("enter a");
        yield* Effect.promise(() => vi.waitFor(() => expect(log).toContain("setup a")));
        actor.send({ type: "leave" });
        const late = yield* end("setup a");
        yield* Effect.sleep("20 millis");
        actor.stop();
        expect(late?.aborted).toBe(true);
        // The app's own Promise runs on; the walk shows no variant after it.
        expect(log).toEqual(["enter a", "setup a", "set a"]);
      }),
    ));

  it("aborts what runs when the tools stop", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { actor, log, end } = promised();
        actor.start();
        actor.send({ type: "choose" });
        yield* Effect.promise(() => vi.waitFor(() => expect(log).toContain("enter a")));
        actor.stop();
        expect((yield* end("enter a"))?.aborted).toBe(true);
      }),
    ));
});

/** What a posted line says it is. */
const Posted = Schema.fromJsonString(Schema.Struct({ kind: Schema.String }));

describe("the channel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts a settle before the notes it sends, so the listener reads them together", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kinds: string[] = [];
        vi.stubGlobal("window", { location: { href: "http://localhost/" } });
        const run = Effect.runPromiseWith(yield* Effect.context());
        vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) =>
          run(
            Effect.gen(function* () {
              if (init?.method !== "POST") return new Response("{}");
              const text = yield* Effect.promise(() => new Response(init.body).text());
              const { kind } = yield* Schema.decodeEffect(Posted)(text);
              // The settle answers late: the note after it must still wait for it.
              if (kind === "settle") yield* Effect.sleep("50 millis");
              kinds.push(kind);
              return new Response("{}");
            }),
          ),
        );
        const { actor } = walk();
        actor.start();
        actor.send({ type: "choose" });
        yield* Effect.promise(() =>
          waitFor(actor, (s) => s.matches({ review: { on: "ready" } }), { timeout: 3000 }),
        );
        const pin = { what: "the field", selector: "#f" };
        actor.send({ type: "point", id: "p1", pin });
        actor.send({ type: "write", id: "p1", step: "a", pin, draft: "Wider" });
        actor.send({ type: "close" });
        actor.send({ type: "settle", at: 5 });
        yield* Effect.promise(() => waitFor(actor, () => kinds.length === 2, { timeout: 3000 }));
        actor.stop();
        expect(kinds).toEqual(["settle", "note"]);
      }),
    ));
});

describe("the page's own review", () => {
  it("has a step for each part on the page, and opens none of the app's world", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const part = (id: string, name: string, labels: readonly string[]) =>
          parts.add({ id, name, labels, states: [], node: () => null });
        const gone = [
          part("1", "Suggestion", ["Card", "Tracked"]),
          part("2", "Suggestion", ["Card", "Tracked"]),
          part("3", "Title", ["As it is"]),
        ];
        const names = pageParts(parts.current().instances);
        expect(names).toEqual(["Suggestion"]);
        const { actor, log } = walk();
        actor.start();
        const page = pageJourney<string>(names);
        actor.send({ type: "journeys", journeys: shapesOf([journey([]), page]) });
        actor.send({ type: "start", journey: PAGE_JOURNEY, at: 0, fresh: false });
        const ready = yield* Effect.promise(() =>
          waitFor(actor, (s) => s.matches({ review: { on: "ready" } }), { timeout: 3000 }),
        );
        actor.stop();
        expect(ready.context.journey).toBe(PAGE_JOURNEY);
        for (const remove of gone) remove();
        expect(pageParts(parts.current().instances)).toEqual([]);
        expect(log).toEqual([]);
      }),
    ));

  it("is listed first among the journeys, as This page, and only when the page shows a part", () => {
    const page = pageJourney<string>(["Suggestion"], "/pursuits");
    const own = journey([]);
    const empty = { ...own, id: "empty", steps: [] };
    expect(listedJourneys([own, empty, page]).map((j) => j.id)).toEqual([PAGE_JOURNEY, "prep"]);
    expect(listedJourneys([own, pageJourney<string>([], "/")]).map((j) => j.id)).toEqual(["prep"]);
    expect(page.title).toBe("This page");
    // Its words name no key: the panel shows none.
    for (const step of page.steps) expect(`${step.look} ${step.try ?? ""}`).not.toMatch(/\b[yv]\b/);
  });

  it("finishes as a journey: the last settle waits for Finish, and Finish hands the review off", () => {
    const page = pageJourney<string>(["Suggestion"], "/pursuits");
    const [first] = initialTransition(sessionMachine, {
      kept: { ...START, journey: PAGE_JOURNEY, active: true },
      journeys: shapesOf([page]),
      now: 0,
    });
    const step = (s: typeof first, e: EventFrom<typeof sessionMachine>) =>
      transition(sessionMachine, s, e)[0];
    const held = step(step(first, { type: "entered" }), { type: "settle" });
    expect(held.context.finish).toEqual({ step: "page:Suggestion", ids: [] });
    const done = step(held, { type: "finish", at: 3 });
    expect(done.context.handoff).toBeNull();
    expect(done.context.notes.some((n) => n.id === handoffId(PAGE_JOURNEY, 3))).toBe(true);
    expect(done.context.feedback["page:Suggestion"]?.settled).toBe(true);
  });

  it("names the part a step lights, once for every part of its name", () => {
    const journey = pageJourney(["Suggestion", 'Say "hi"']);
    expect(journey.steps.map((s) => s.id)).toEqual(["page:Suggestion", 'page:Say "hi"']);
    expect(journey.steps.map((s) => s.part)).toEqual(["Suggestion", 'Say "hi"']);
    expect(journey.steps[1]?.target).toEqual(['[data-blueline-part="Say \\"hi\\""]']);
  });
});

describe("the lines the agent reads", () => {
  const steps = journey([]);
  const session = {
    ...START,
    journey: "prep",
    journeys: [],
    place: "",
    run: 1,
    fresh: false,
    entered: undefined,
    opening: undefined,
    leaving: undefined,
    trouble: {},
    cursor: 0,
    row: undefined,
    tree: false,
    opened: undefined,
    preview: false,
    listened: undefined,
    posts: 0,
    past: [],
    future: [],
    variants: { b: 1 },
    notes: [
      {
        id: stepNoteId("b"),
        step: "b",
        thread: [
          {
            by: "you" as const,
            text: "",
            at: 1,
            pins: [
              {
                id: "p1",
                pin: { what: "the “Safety” field", selector: "#safety" },
                text: "Bolder",
              },
            ],
          },
        ],
        draft: "",
        state: "waiting" as const,
        unread: false,
      },
    ],
  };

  it("sends a note on a page to the page's own review", () => {
    const place = "place:/pursuits";
    const note = {
      id: stepNoteId(place),
      step: place,
      thread: [{ by: "you" as const, text: "Smaller header", at: 1 }],
      draft: "",
      state: "waiting" as const,
      unread: false,
    };
    const line = postedLine(
      [steps],
      { kind: "note", ids: [note.id], session: { ...session, notes: [note] } },
      "now",
    );
    expect(line).toMatchObject({
      journey: "page",
      step: { id: place, group: "/pursuits", title: "This page" },
    });
  });

  it("sends pointed notes without words in the step's chat, which the agent answers", () => {
    const line = postedLine([steps], { kind: "note", ids: [stepNoteId("b")], session }, "now");
    expect(line).toMatchObject({
      kind: "note",
      id: stepNoteId("b"),
      sentWords: false,
      variantShowing: "Two",
      step: { number: 2, group: "Group", title: "Step b" },
      pins: [{ pin: { what: "the “Safety” field" }, text: "Bolder" }],
    });
    // A pointed note has no ID of its own to answer.
    expect(line).not.toHaveProperty("pins.0.id");
  });

  it("says on a settle how many steps are still open", () => {
    const one = { ...session, feedback: { b: { settled: true } } };
    expect(
      postedLine([steps], { kind: "settle", ids: [], step: "b", session: one }, "now"),
    ).toMatchObject({ kind: "settle", settled: true, left: steps.steps.length - 1 });
    const all = {
      ...session,
      feedback: Object.fromEntries(steps.steps.map((s) => [s.id, { settled: true }])),
    };
    expect(
      postedLine([steps], { kind: "settle", ids: [], step: "b", session: all }, "now"),
    ).toMatchObject({ left: 0 });
  });

  it("names the hand-off on the settle that Finish sends, so the agent answers the review there", () => {
    const all = {
      ...session,
      feedback: Object.fromEntries(steps.steps.map((s) => [s.id, { settled: true }])),
    };
    const line = postedLine(
      [steps],
      { kind: "settle", ids: [], step: "b", session: all, handoff: "finish-prep-5" },
      "now",
    );
    expect(line).toMatchObject({
      kind: "settle",
      left: 0,
      id: "finish-prep-5",
      reply: expect.stringContaining("blueline reply <status.json> finish-prep-5 working"),
    });
    expect(
      postedLine([steps], { kind: "settle", ids: [], step: "b", session: all }, "now"),
    ).not.toHaveProperty("id");
  });

  it("says on a settle which of the step's own variants the reviewer kept", () => {
    const kept = { ...session, feedback: { b: { settled: true, variant: "Two" } } };
    expect(
      postedLine([steps], { kind: "settle", ids: [], step: "b", session: kept }, "now"),
    ).toMatchObject({ variant: "Two", keep: expect.stringContaining('"Two"') });
    const plain = { ...session, feedback: { b: { settled: true } } };
    expect(
      postedLine([steps], { kind: "settle", ids: [], step: "b", session: plain }, "now"),
    ).not.toHaveProperty("variant");
  });

  it("sends the variants kept and deleted in the step's parts with the note", () => {
    const parts = { Suggestion: { kept: ["Tracked change"], dropped: ["Marked field"] } };
    const judged = { ...session, feedback: { b: { parts } } };
    expect(
      postedLine([steps], { kind: "note", ids: [stepNoteId("b")], session: judged }, "now"),
    ).toMatchObject({
      parts,
      apply: expect.stringContaining("blueline apply <feedback.jsonl> --part"),
    });
    expect(
      postedLine([steps], { kind: "note", ids: [stepNoteId("b")], session }, "now"),
    ).not.toHaveProperty("parts");
  });
});

/** A walk of steps with every phase, each of which says what it does. */
function phased(more: Readonly<Record<string, Partial<DevStep<string>>>> = {}) {
  const log: string[] = [];
  const said = (what: string) => () => void log.push(what);
  const step = (id: string): DevStep<string> => ({
    id,
    title: `Step ${id}`,
    look: "",
    group: { id: "g", title: "Group" },
    setup: said(`setup ${id}`),
    reset: said(`reset ${id}`),
    ready: said(`ready ${id}`),
    exit: said(`exit ${id}`),
    ...more[id],
  });
  const adapter: DevAdapter<string> = {
    journeys: [{ id: "prep", title: "Prep", steps: [step("a"), step("b"), step("c")] }],
    context: () => "page",
    enter: (s) => {
      log.push(`enter ${s.id}`);
      return "world";
    },
  };
  const machine = liveMachine({ adapter, shift: () => undefined });
  const actor = createActor(machine, {
    input: { kept: { ...START, journey: "prep" }, journeys: shapesOf(adapter.journeys), now: 0 },
  });
  const ready = (at: number) =>
    waitFor(actor, (s) => s.matches({ review: { on: "ready" } }) && s.context.at === at, {
      timeout: 3000,
    });
  return { actor, machine, log, ready };
}

/** A Promise the test ends. */
function held() {
  let end = () => undefined as void;
  const promise = new Promise<void>((done) => (end = done));
  return { promise, end: () => end() };
}

describe("a step's phases", () => {
  it("runs reset, setup, the variant and ready for a step, and reset then exit on leaving", async () => {
    const { actor, log, ready } = phased();
    actor.start();
    actor.send({ type: "choose" });
    await ready(0);
    actor.send({ type: "go", by: 1 });
    await ready(1);
    expect(log).toEqual([
      "enter a",
      "reset a",
      "setup a",
      "ready a",
      "reset a",
      "exit a",
      "enter b",
      "reset b",
      "setup b",
      "ready b",
    ]);
    actor.stop();
  });

  it("runs exit when reset failed, and opens the next step only after both", async () => {
    const exit = held();
    let resets = 0;
    const { actor, log, ready } = phased({
      a: {
        reset: () => {
          resets += 1;
          if (resets > 1) throw new Error("no reset");
        },
        exit: () => {
          log.push("exit a");
          return exit.promise;
        },
      },
    });
    actor.start();
    actor.send({ type: "choose" });
    await ready(0);
    actor.send({ type: "go", by: 1 });
    await vi.waitFor(() => expect(log).toContain("exit a"));
    await new Promise((done) => setTimeout(done, 50));
    expect(log).not.toContain("enter b");
    exit.end();
    await ready(1);
    expect(log.slice(log.indexOf("exit a"))).toEqual([
      "exit a",
      "enter b",
      "reset b",
      "setup b",
      "ready b",
    ]);
    actor.stop();
  });

  it("opens only the newest step when the reviewer goes on while the walk leaves", async () => {
    const exit = held();
    const { actor, log, ready } = phased({
      a: { exit: () => (log.push("exit a"), exit.promise) },
    });
    actor.start();
    actor.send({ type: "choose" });
    await ready(0);
    actor.send({ type: "go", by: 1 });
    await vi.waitFor(() => expect(log).toContain("exit a"));
    actor.send({ type: "go", by: 1 });
    exit.end();
    await ready(2);
    expect(log).not.toContain("enter b");
    expect(log).toContain("enter c");
    actor.stop();
  });

  it("leaves the step on leave, and when the tools are taken off", async () => {
    const { actor, machine, log, ready } = phased();
    actor.start();
    actor.send({ type: "choose" });
    await ready(0);
    actor.send({ type: "leave" });
    await vi.waitFor(() => expect(log.slice(-2)).toEqual(["reset a", "exit a"]));
    actor.send({ type: "choose" });
    await ready(0);
    const { entered } = actor.getSnapshot().context;
    actor.stop();
    machine.dispose(entered);
    await vi.waitFor(() => expect(log.slice(-2)).toEqual(["reset a", "exit a"]));
  });

  it("fails a phase too late with its reason, runs none after it, and drops the reason when the step opens again", async () => {
    let tries = 0;
    const { actor, log, ready } = phased({
      a: {
        timeout: 100,
        setup: (_, signal) => {
          tries += 1;
          log.push("setup a");
          // The first setup never ends; its signal aborts at the deadline.
          return tries > 1
            ? undefined
            : new Promise<void>((_done, fail) =>
                signal.addEventListener("abort", () => fail(new Error("aborted"))),
              );
        },
      },
    });
    actor.start();
    actor.send({ type: "choose" });
    await vi.waitFor(() =>
      expect(actor.getSnapshot().context.trouble).toEqual({ a: "setup did not end in 0.1 s" }),
    );
    expect(log).not.toContain("ready a");
    actor.send({ type: "go", by: 1 });
    await ready(1);
    actor.send({ type: "go", by: -1 });
    await ready(0);
    expect(actor.getSnapshot().context.trouble).toEqual({});
    expect(log.at(-1)).toBe("ready a");
    actor.stop();
  });

  it("says why a phase failed, and keeps no reason of a run the walk left", async () => {
    const setup = held();
    const { actor, ready } = phased({
      a: {
        ready: () => {
          throw new Error("no panel");
        },
      },
      b: { setup: () => setup.promise },
    });
    actor.start();
    actor.send({ type: "choose" });
    await vi.waitFor(() =>
      expect(actor.getSnapshot().context.trouble).toEqual({ a: "ready failed: no panel" }),
    );
    actor.send({ type: "go", by: 1 });
    await vi.waitFor(() => expect(actor.getSnapshot().context.at).toBe(1));
    actor.send({ type: "go", by: 1 });
    await ready(2);
    setup.end();
    expect(actor.getSnapshot().context.trouble).toEqual({ a: "ready failed: no panel" });
    actor.stop();
  });
});

describe("leaving a step, as review found it", () => {
  it("runs no second reset while the variant's reset still runs", async () => {
    const first = held();
    let resets = 0;
    const { actor, log, ready } = phased({
      a: {
        reset: () => {
          resets += 1;
          log.push(`reset ${String(resets)}`);
          // The variant's reset holds; the leaving reset ends at once.
          return resets === 1 ? first.promise : undefined;
        },
      },
    });
    actor.start();
    actor.send({ type: "choose" });
    await vi.waitFor(() => expect(log).toContain("reset 1"));
    actor.send({ type: "go", by: 1 });
    await new Promise((done) => setTimeout(done, 50));
    expect(log).not.toContain("reset 2");
    first.end();
    await ready(1);
    expect(log.slice(log.indexOf("reset 2"))).toEqual([
      "reset 2",
      "exit a",
      "enter b",
      "reset b",
      "setup b",
      "ready b",
    ]);
    actor.stop();
  });

  it("leaves only a step whose world began to open", async () => {
    const exit = held();
    const { actor, log, ready } = phased({
      a: { exit: () => (log.push("exit a"), exit.promise) },
    });
    actor.start();
    actor.send({ type: "choose" });
    await ready(0);
    actor.send({ type: "go", by: 1 });
    await vi.waitFor(() => expect(log).toContain("exit a"));
    actor.send({ type: "go", by: 1 });
    exit.end();
    await ready(2);
    expect(log).not.toContain("reset b");
    expect(log).not.toContain("exit b");
    actor.stop();
  });

  it("says why the step it left failed to leave", async () => {
    const { actor, ready } = phased({
      a: {
        exit: () => {
          throw new Error("close failed");
        },
      },
    });
    actor.start();
    actor.send({ type: "choose" });
    await ready(0);
    actor.send({ type: "go", by: 1 });
    await ready(1);
    await vi.waitFor(() =>
      expect(actor.getSnapshot().context.trouble).toEqual({ a: "exit failed: close failed" }),
    );
    actor.stop();
  });
});
