import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";
import { PAGE_JOURNEY, pageJourney, pageParts } from "../src/part/page";
import { parts } from "../src/part/store";
import { liveMachine, shapesOf } from "../src/session/actors";
import { postedLine } from "../src/session/lines";
import { stepNoteId } from "../src/session/machine";
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
        expect(log).toEqual([
          "enter a",
          "setup a",
          "reset a",
          "reset a",
          "enter b",
          "setup b",
          "reset b",
          "apply b One",
        ]);
        expect(shifts.at(-1)).toBeUndefined();
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
    cursor: 0,
    row: undefined,
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
