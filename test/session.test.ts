import { describe, expect, it } from "vitest";
import {
  createActor,
  fromCallback,
  initialTransition,
  transition,
  type SnapshotFrom,
} from "xstate";
import { isWithAgent } from "../src/notes/note";
import { sessionMachine, stepNoteId, type Event, type Post } from "../src/session/machine";
import { keptOf } from "../src/io/storage";
import { START, type Shape } from "../src/session/state";

const JOURNEYS: readonly Shape[] = [
  {
    id: "prep",
    steps: [
      { id: "a", group: "P1", variants: [] },
      { id: "b", group: "P1", variants: ["One", "Two", "Three"] },
      { id: "c", group: "P2", variants: ["X", "Y"] },
    ],
  },
];

type Snapshot = SnapshotFrom<typeof sessionMachine>;

const start = (active = false): Snapshot =>
  initialTransition(sessionMachine, {
    kept: { ...START, journey: "prep", active },
    journeys: JOURNEYS,
    now: 0,
  })[0];

const after = (snapshot: Snapshot, ...events: readonly Event[]) =>
  events.reduce((s, e) => transition(sessionMachine, s, e)[0], snapshot);

const pin = { what: "the “Safety” field", selector: "#safety" };

const ALPHABET: readonly Event[] = [
  { type: "leave" },
  { type: "chat" },
  { type: "go", by: 1 },
  { type: "go", by: -1 },
  { type: "go", by: 1, open: true },
  { type: "variant", by: 1 },
  { type: "entered" },
  { type: "switched" },
  { type: "sidebar" },
  { type: "cursor", by: 1 },
  { type: "cursorOpen", by: 1 },
  { type: "choose" },
  { type: "reset" },
  { type: "open", layer: "notes" },
  { type: "escape" },
  { type: "preview" },
  { type: "point", id: "p1", pin },
  { type: "write", id: "p1", step: "b", pin, draft: "Bold" },
  { type: "send", id: stepNoteId("b"), step: "b", at: 1 },
  { type: "settle" },
  { type: "settle", step: 2 },
  {
    type: "replies",
    replies: {
      [stepNoteId("b")]: { state: "replied", replies: [{ text: "Done", variant: "Two" }] },
    },
  },
];

/** Every snapshot reachable in up to `depth` events, by its state and context. */
function reachable(depth: number) {
  const seen = new Map<string, { snapshot: Snapshot; path: readonly Event[] }>();
  let frontier = [{ snapshot: start(), path: [] as readonly Event[] }];
  for (let d = 0; d <= depth; d += 1) {
    const next: typeof frontier = [];
    for (const item of frontier) {
      const { journeys: _, ...context } = item.snapshot.context;
      const key = JSON.stringify([item.snapshot.value, context]);
      if (seen.has(key)) continue;
      seen.set(key, item);
      for (const event of ALPHABET)
        next.push({ snapshot: after(item.snapshot, event), path: [...item.path, event] });
    }
    frontier = next;
  }
  return [...seen.values()];
}

const all = reachable(5);
const why = (path: readonly Event[]) => path.map((e) => e.type).join(" > ");

describe("the review session, over every path of up to five events", () => {
  it("covers the walk's states", () => {
    const states = new Set(all.map(({ snapshot }) => JSON.stringify(snapshot.value)));
    expect([...states].some((s) => s.includes("switching"))).toBe(true);
    expect([...states].some((s) => s.includes("pinned"))).toBe(true);
    expect([...states].some((s) => s.includes("polling"))).toBe(true);
  });

  it("keeps the step and the sidebar's selection on the journey", () => {
    for (const { snapshot, path } of all) {
      const { at, cursor } = snapshot.context;
      expect(at >= 0 && at <= 2 && cursor >= 0 && cursor <= 2, why(path)).toBe(true);
    }
  });

  it("is ready only when the page shows the step and the variant the session says", () => {
    for (const { snapshot, path } of all) {
      if (!snapshot.matches({ review: { on: "ready" } })) continue;
      const { entered, at, variants, journey } = snapshot.context;
      const step = JOURNEYS[0]?.steps[at];
      expect(entered, why(path)).toEqual(
        expect.objectContaining({ journey, at, variant: variants[step?.id ?? ""] ?? 0 }),
      );
    }
  });

  it("has an open pointed note exactly when the layer is a pointed note", () => {
    for (const { snapshot, path } of all) {
      const pinned = snapshot.matches({ layer: "pinned" });
      expect(snapshot.context.opened !== undefined, why(path)).toBe(pinned);
      if (pinned)
        expect(
          snapshot.context.notes.some((n) => n.id === snapshot.context.opened),
          why(path),
        ).toBe(true);
    }
  });

  it("reads the agent's replies exactly while a step is open or a note waits", () => {
    for (const { snapshot, path } of all)
      expect(snapshot.matches({ agent: "polling" }), why(path)).toBe(
        snapshot.context.active || snapshot.context.notes.some(isWithAgent),
      );
  });

  it("keeps a pointed note only while it waits: it has no chat of its own", () => {
    for (const { snapshot, path } of all)
      for (const n of snapshot.context.notes)
        if (n.pin !== undefined) {
          expect(n.thread, why(path)).toEqual([]);
          if (n.id !== snapshot.context.opened) expect(n.draft.trim(), why(path)).not.toBe("");
        }
  });
});

describe("the review session", () => {
  it("opens a step, then switches its variant without opening it again", () => {
    let s = after(start(), { type: "choose" }, { type: "entered" }, { type: "go", by: 1 });
    expect(s.matches({ review: { on: "entering" } })).toBe(true);
    s = after(s, { type: "entered" }, { type: "variant", by: 1 });
    expect(s.matches({ review: { on: "switching" } })).toBe(true);
    s = after(s, { type: "switched" });
    expect(s.matches({ review: { on: "ready" } })).toBe(true);
    expect(s.context.variants["b"]).toBe(1);
  });

  it("switches to a variant chosen while the step opened, once it is open", () => {
    let s = after(start(), { type: "choose" }, { type: "entered" }, { type: "go", by: 1 });
    s = after(s, { type: "variant", by: 1 }, { type: "entered" });
    expect(s.matches({ review: { on: "switching" } })).toBe(true);
  });

  it("tells the next step's opening which step it leaves, so that step's state goes", () => {
    const s = after(start(), { type: "choose" }, { type: "go", by: 1 }, { type: "entered" });
    const next = after(s, { type: "go", by: 1 });
    expect(next.context.leaving).toEqual(expect.objectContaining({ at: 1 }));
  });

  it("leaves a step that a key press stopped halfway, as its variant can be on the page", () => {
    const s = after(start(), { type: "choose" }, { type: "entered" }, { type: "go", by: 1 });
    const next = after(s, { type: "go", by: 1 });
    expect(next.context.leaving).toEqual(expect.objectContaining({ at: 1 }));
    expect(next.context.entered).toEqual(expect.objectContaining({ at: 0 }));
  });

  it("closes what is open when the reviewer moves on", () => {
    const s = after(
      start(),
      { type: "choose" },
      { type: "entered" },
      { type: "open", layer: "notes" },
    );
    expect(s.matches({ layer: "notes" })).toBe(true);
    expect(after(s, { type: "go", by: 1 }).matches({ layer: "none" })).toBe(true);
  });

  it("hides the tools in the preview, in a review or not, and shows them for a note", () => {
    const shown = after(start(true), { type: "entered" });
    const preview = after(shown, { type: "preview" });
    expect(preview.context.preview).toBe(true);
    expect(after(preview, { type: "go", by: 1 }).context).toMatchObject({ preview: true, at: 1 });
    expect(after(preview, { type: "preview" }).context.preview).toBe(false);
    expect(after(preview, { type: "point", id: "p1", pin }).context.preview).toBe(false);
    expect(after(preview, { type: "leave" }).context.preview).toBe(false);
    // Off a step, the preview hides the page's notes, and a step opened shows them again.
    const page = after(start(), { type: "preview" });
    expect(page.context.preview).toBe(true);
    expect(after(page, { type: "choose" }).context.preview).toBe(false);
  });

  it("opens the step selected in the sidebar, also when no review runs", () => {
    const s = after(
      start(),
      { type: "sidebar" },
      { type: "cursor", by: 1 },
      { type: "cursor", by: 1 },
      { type: "choose" },
    );
    expect(s.matches({ review: "on" })).toBe(true);
    expect(s.context.at).toBe(2);
  });

  it("builds the step again on reset", () => {
    const on = after(start(), { type: "choose" }, { type: "entered" }, { type: "go", by: 1 });
    const walked = after(on, { type: "entered" });
    const reset = after(walked, { type: "reset" });
    expect(reset.context).toMatchObject({ at: 1, fresh: true, run: walked.context.run + 1 });
    expect(reset.matches({ review: { on: "entering" } })).toBe(true);
  });

  it("selects the open steps in the sidebar with Ctrl+J and Ctrl+K", () => {
    const settled = initialTransition(sessionMachine, {
      kept: { ...START, journey: "prep", feedback: { b: { settled: true } } },
      journeys: JOURNEYS,
      now: 0,
    })[0];
    const down = after(settled, { type: "sidebar" }, { type: "cursorOpen", by: 1 });
    expect(down.context.cursor).toBe(2);
    expect(after(down, { type: "cursorOpen", by: 1 }).context.cursor).toBe(2);
    expect(after(down, { type: "cursorOpen", by: -1 }).context.cursor).toBe(0);
  });

  it("keeps the sidebar's open and closed rows, which a reload keeps", () => {
    const open = after(
      start(),
      { type: "sidebar" },
      { type: "fold", id: "journey:prep", open: true },
      { type: "fold", id: "page:place:/", open: false },
    );
    expect(open.context.folds).toEqual({ "journey:prep": true, "page:place:/": false });
    expect(keptOf(open.context).folds).toEqual(open.context.folds);
    const closed = after(open, { type: "fold", id: "journey:prep", open: false });
    expect(closed.context.folds["journey:prep"]).toBe(false);
  });

  it("sends the step's note with its pointed notes", () => {
    let s = after(
      start(),
      { type: "choose" },
      { type: "entered" },
      { type: "go", by: 1 },
      { type: "entered" },
    );
    s = after(
      s,
      { type: "point", id: "p1", pin },
      { type: "write", id: "p1", step: "b", pin, draft: "Bold" },
      { type: "escape" },
    );
    const [sent, actions] = transition(sessionMachine, s, {
      type: "send",
      id: stepNoteId("b"),
      step: "b",
      at: 5,
    });
    expect(sent.context.notes.some((n) => n.id === "p1")).toBe(false);
    expect(sent.context.notes.find((n) => n.id === stepNoteId("b"))?.state).toBe("waiting");
    expect(actions.some((a) => a.type === "xstate.spawnChild")).toBe(true);
  });

  it("sends the pointed notes alone as a message with no words, and keeps the step's draft", () => {
    let s = after(
      start(),
      { type: "choose" },
      { type: "entered" },
      { type: "write", id: stepNoteId("a"), step: "a", draft: "Half" },
      { type: "point", id: "p1", pin },
      { type: "write", id: "p1", step: "a", pin, draft: "Bold" },
      { type: "escape" },
    );
    s = after(s, { type: "send", id: stepNoteId("a"), step: "a", at: 5, text: "" });
    const step = s.context.notes.find((n) => n.id === stepNoteId("a"));
    expect(step?.thread.at(-1)).toMatchObject({ by: "you", text: "", at: 5 });
    expect(step?.thread.at(-1)?.pins?.map((p) => p.text)).toEqual(["Bold"]);
    expect(step?.draft).toBe("Half");
    expect(s.context.notes.some((n) => n.id === "p1")).toBe(false);
  });

  it("ends a post once sent, so a session built again from its snapshot posts nothing again", () => {
    let posts = 0;
    const machine = sessionMachine.provide({
      actors: {
        post: fromCallback<Event, Post>(({ sendBack, self }) => {
          posts += 1;
          sendBack({ type: "posted", child: self.id });
        }),
      },
    });
    const input = { kept: { ...START, journey: "prep" }, journeys: JOURNEYS, now: 0 };
    const actor = createActor(machine, { input }).start();
    for (const event of [
      { type: "choose" },
      { type: "entered" },
      { type: "write", id: "x", step: "a", draft: "Bold" },
      { type: "send", id: "x", step: "a", at: 1 },
    ] satisfies Event[])
      actor.send(event);
    expect(posts).toBe(1);
    const again = createActor(machine, { input, snapshot: actor.getPersistedSnapshot() }).start();
    expect(posts).toBe(1);
    again.stop();
    actor.stop();
  });

  it("shows the agent's variant and tells the reviewer of the reply", () => {
    const actor = createActor(sessionMachine, {
      input: { kept: { ...START, journey: "prep" }, journeys: JOURNEYS, now: 0 },
    }).start();
    const told: string[] = [];
    actor.on("replied", (e) => told.push(e.note.id));
    for (const event of [
      { type: "choose" },
      { type: "entered" },
      { type: "go", by: 1 },
      { type: "entered" },
      { type: "write", id: "x", step: "b", draft: "Try three" },
      { type: "send", id: "x", step: "b", at: 1 },
      {
        type: "replies",
        replies: { x: { state: "replied", replies: [{ text: "Made it", variant: "Three" }] } },
      },
    ] satisfies Event[])
      actor.send(event);
    const { context } = actor.getSnapshot();
    expect(context.variants["b"]).toBe(2);
    expect(context.notes.find((n) => n.id === "x")?.state).toBe("replied");
    expect(told).toEqual(["x"]);
    actor.stop();
  });

  it("shows the agent's progress from the status file in place, and drops it at the reply", () => {
    const id = stepNoteId("a");
    const plan = (state: "doing" | "done") =>
      [{ kind: "plan", items: [{ text: "Make it bold", state }] }] as const;
    const working = (state: "doing" | "done"): Event => ({
      type: "replies",
      replies: { [id]: { state: "working", progress: plan(state) } },
    });
    const sent = after(
      start(),
      { type: "choose" },
      { type: "entered" },
      { type: "write", id, step: "a", draft: "Bold" },
      { type: "send", id, step: "a", at: 1 },
    );
    const doing = after(sent, working("doing"));
    const chat = (s: Snapshot) => s.context.notes.find((n) => n.id === id);
    expect([chat(doing)?.state, chat(doing)?.progress]).toEqual(["working", plan("doing")]);
    const done = after(doing, working("done"));
    expect(chat(done)?.progress).toEqual(plan("done"));
    expect(chat(done)?.thread).toHaveLength(1);
    const replied = after(done, {
      type: "replies",
      replies: { [id]: { state: "replied", replies: [{ text: "Bold now" }] } },
    });
    expect([chat(replied)?.state, chat(replied)?.progress]).toEqual(["replied", undefined]);
  });

  it("empties the step's chat with /clear, and its old replies stay out of the new one", () => {
    const id = stepNoteId("b");
    const actor = createActor(sessionMachine, {
      input: { kept: { ...START, journey: "prep" }, journeys: JOURNEYS, now: 0 },
    }).start();
    const reply = (...texts: readonly string[]): Event => ({
      type: "replies",
      replies: { [id]: { state: "replied", replies: texts.map((text) => ({ text })) } },
    });
    for (const event of [
      { type: "choose" },
      { type: "entered" },
      { type: "go", by: 1 },
      { type: "entered" },
      { type: "write", id, step: "b", draft: "Try three" },
      { type: "send", id, step: "b", at: 1 },
      reply("Made it"),
      { type: "clear", step: "b" },
      // The status file keeps the old reply; only the new one joins the new chat.
      reply("Made it"),
    ] satisfies Event[])
      actor.send(event);
    const cleared = actor.getSnapshot().context.notes.find((n) => n.id === id);
    expect(cleared?.thread).toEqual([]);
    for (const event of [
      { type: "write", id, step: "b", draft: "Now a fourth" },
      { type: "send", id, step: "b", at: 2 },
      reply("Made it", "Made a fourth"),
    ] satisfies Event[])
      actor.send(event);
    const after = actor.getSnapshot().context.notes.find((n) => n.id === id);
    expect(after?.thread.map((m) => m.text)).toEqual(["Now a fourth", "Made a fourth"]);
    actor.stop();
  });

  it("undoes and redoes removing a note, and keeps a reply the agent gave meanwhile", () => {
    let s = after(
      start(),
      { type: "choose" },
      { type: "entered" },
      { type: "go", by: 1 },
      { type: "entered" },
    );
    s = after(
      s,
      { type: "write", id: "x", step: "b", draft: "Bold" },
      { type: "write", id: "y", step: "b", draft: "Ask" },
      { type: "send", id: "y", step: "b", at: 1 },
      { type: "remove", id: "x" },
      { type: "replies", replies: { y: { state: "replied", replies: [{ text: "Yes" }] } } },
    );
    expect(s.context.notes.some((n) => n.id === "x")).toBe(false);
    const undone = after(s, { type: "undo" });
    expect(undone.context.notes.find((n) => n.id === "x")?.draft).toBe("Bold");
    expect(undone.context.notes.find((n) => n.id === "y")?.state).toBe("replied");
    const redone = after(undone, { type: "redo" });
    expect(redone.context.notes.some((n) => n.id === "x")).toBe(false);
    expect(
      after(redone, { type: "undo" }, { type: "undo" }).context.notes.some((n) => n.id === "x"),
    ).toBe(true);
  });

  it("undoes a settle, and a new action clears what redo had", () => {
    let s = after(start(), { type: "choose" }, { type: "entered" });
    s = after(s, { type: "settle" }, { type: "undo" });
    expect(s.context.feedback["a"]?.settled).toBeUndefined();
    // The settle went on to the next step; undo goes back to the one it settled.
    expect(s.context.at).toBe(0);
    s = after(s, { type: "entered" });
    expect(s.context.future).toHaveLength(1);
    s = after(s, { type: "settle" });
    expect(s.context.future).toHaveLength(0);
    expect(s.context.feedback["a"]?.settled).toBe(true);
  });
});

describe("a settle from the sidebar", () => {
  it("settles the selected step, and moves the walk and the selection on", () => {
    let s = after(start(), { type: "choose" }, { type: "entered" }, { type: "sidebar" });
    s = after(s, { type: "settle", step: 1 });
    expect(s.context.feedback["b"]?.settled).toBe(true);
    expect(s.context.feedback["a"]?.settled).toBeUndefined();
    expect(s.context.at).toBe(2);
    expect(s.context.cursor).toBe(2);
    // Again on the settled step, it opens it again, and the walk and the selection stay.
    s = after(s, { type: "entered" }, { type: "cursor", by: -1 }, { type: "settle", step: 1 });
    expect(s.context.feedback["b"]?.settled).toBe(false);
    expect(s.context.cursor).toBe(1);
    expect(s.context.at).toBe(2);
    expect(after(s, { type: "undo" }).context.feedback["b"]?.settled).toBe(true);
  });

  it("goes on from the step the page shows, as y on the page does", () => {
    const open = after(start(), { type: "choose" }, { type: "entered" }, { type: "sidebar" });
    expect(open.context.cursor).toBe(open.context.at);
    const s = after(open, { type: "settle", step: open.context.at });
    expect(s.context.feedback["a"]?.settled).toBe(true);
    expect(s.context.at).toBe(1);
    expect(s.context.cursor).toBe(1);
    expect(s.context.chat).toBe(open.context.chat);
  });

  it("goes back to an open step before when none is after", () => {
    let s = after(start(), { type: "choose" }, { type: "entered" }, { type: "sidebar" });
    s = after(s, { type: "settle", step: 2 });
    expect(s.context.feedback["c"]?.settled).toBe(true);
    expect(s.context.at).toBe(1);
    expect(s.context.cursor).toBe(1);
  });

  it("undoes the settle back to the step the page showed", () => {
    let s = after(start(), { type: "choose" }, { type: "entered" }, { type: "sidebar" });
    s = after(s, { type: "settle", step: 1 }, { type: "entered" }, { type: "undo" });
    expect(s.context.feedback["b"]?.settled).toBeUndefined();
    expect(s.context.at).toBe(0);
  });
});

describe("the review's end", () => {
  const lastOpen = () =>
    after(
      initialTransition(sessionMachine, {
        kept: {
          ...START,
          journey: "prep",
          active: true,
          at: 2,
          feedback: { a: { settled: true } },
        },
        journeys: JOURNEYS,
        now: 0,
      })[0],
      { type: "entered" },
    );

  it("ends the review when the last open step settles: the tools show the page, and the walk stays on the step", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    expect(s.matches({ review: "on" })).toBe(true);
    expect(s.context.at).toBe(2);
    const done = after(s, { type: "entered" }, { type: "settle" });
    expect(done.matches({ review: "off" })).toBe(true);
    expect(done.context).toMatchObject({ active: false, page: true, sidebar: false, at: 2 });
    expect(done.context.feedback["c"]?.settled).toBe(true);
  });

  it("ends it also when the sidebar settles the last open step, and leaves the sidebar open", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const done = after(s, { type: "entered" }, { type: "sidebar" }, { type: "settle", step: 2 });
    expect(done.context.feedback["c"]?.settled).toBe(true);
    expect(done.matches({ review: "off" })).toBe(true);
    expect(done.context).toMatchObject({ sidebar: true, at: 2, cursor: 2 });
  });

  it("tells the tools the journey is done", () => {
    const actor = createActor(sessionMachine, {
      input: {
        kept: {
          ...START,
          journey: "prep",
          active: true,
          at: 2,
          feedback: { a: { settled: true }, b: { settled: true } },
        },
        journeys: JOURNEYS,
        now: 0,
      },
    }).start();
    const done: string[] = [];
    actor.on("done", (e) => done.push(e.journey));
    actor.send({ type: "entered" });
    actor.send({ type: "settle" });
    expect(done).toEqual(["prep"]);
    actor.stop();
  });

  it("goes back to the step from the page when u takes the last settle back", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const done = after(s, { type: "entered" }, { type: "settle" });
    const undone = after(done, { type: "undo" });
    expect(undone.context.feedback["c"]?.settled).toBeUndefined();
    expect(undone.matches({ review: "on" })).toBe(true);
    expect(undone.context).toMatchObject({ active: true, at: 2 });
  });

  it("opens every step again for another pass when the settled journey starts again", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const done = after(
      s,
      { type: "entered" },
      { type: "settle", keep: { part: "Suggestion", variant: "Card" } },
    );
    expect(done.context.feedback["c"]?.parts?.["Suggestion"]?.kept).toEqual(["Card"]);
    // A step opened alone, as a reply on it opens it, keeps the journey settled.
    const looked = after(done, { type: "start", journey: "prep", at: 1, fresh: false });
    expect(looked.context.feedback["b"]?.settled).toBe(true);
    const again = after(done, { type: "start", journey: "prep", at: 0, fresh: false, again: true });
    expect(again.matches({ review: "on" })).toBe(true);
    expect(again.context.at).toBe(0);
    for (const id of ["a", "b", "c"]) expect(again.context.feedback[id]?.settled).toBe(false);
    expect(again.context.feedback["c"]?.parts?.["Suggestion"]?.kept).toEqual([]);
    // u takes the new pass back: every step is settled again.
    const undone = after(again, { type: "undo" });
    for (const id of ["a", "b", "c"]) expect(undone.context.feedback[id]?.settled).toBe(true);
  });

  it("keeps a journey's settled steps when it starts with a step still open", () => {
    const s = after(
      lastOpen(),
      { type: "leave" },
      { type: "start", journey: "prep", at: 2, fresh: false },
    );
    expect(s.context.feedback["a"]?.settled).toBe(true);
    expect(s.context.at).toBe(2);
  });
});

describe("settling a step", () => {
  const ready = () => after(start(), { type: "choose" }, { type: "entered" });
  const note = stepNoteId("a");
  const asked = () =>
    after(
      ready(),
      { type: "write", id: note, step: "a", draft: "Make it bold" },
      { type: "send", id: note, step: "a", at: 1 },
    );

  it("sends the step's notes not sent yet with the settle, and keeps the chat open", () => {
    const pin = { what: "the field", selector: "#f" };
    const s = after(
      ready(),
      { type: "point", id: "p1", pin },
      { type: "write", id: "p1", step: "a", pin, draft: "Wider" },
      { type: "close" },
      { type: "settle", at: 5 },
    );
    expect(s.context.feedback["a"]?.settled).toBe(true);
    // The note goes in the step's chat, which the agent works on while the step is settled.
    const chat = s.context.notes.find((n) => n.id === stepNoteId("a"));
    expect(chat?.state).toBe("waiting");
    expect(chat?.thread.at(-1)?.pins?.map((p) => p.text)).toEqual(["Wider"]);
    // One post: the settle, then the notes, in order.
    expect(s.context.posts).toBe(1);
  });

  it("settles the step's notes, also one the agent works on", () => {
    const s = after(asked(), { type: "settle" });
    expect(s.context.feedback["a"]?.settled).toBe(true);
    expect(s.context.notes.find((n) => n.id === note)?.state).toBe("settled");
    // The review is still on, so the page still reads replies, as the agent may settle.
    expect(s.matches({ agent: "polling" })).toBe(s.context.active);
  });

  it("opens the step again with y, or with a new message", () => {
    const settled = after(asked(), { type: "settle" });
    const again = after(settled, { type: "jump", at: 0 }, { type: "entered" }, { type: "settle" });
    expect(again.context.at).toBe(0);
    expect(again.context.feedback["a"]?.settled).toBe(false);
    expect(again.context.notes.find((n) => n.id === note)?.state).not.toBe("settled");
    const written = after(
      settled,
      { type: "write", id: note, step: "a", draft: "One more thing" },
      { type: "send", id: note, step: "a", at: 2 },
    );
    expect(written.context.feedback["a"]?.settled).toBe(false);
    expect(written.context.notes.find((n) => n.id === note)?.state).toBe("waiting");
  });

  it("goes on to the next open step, or back to one before when none is after", () => {
    const s = after(ready(), { type: "settle" });
    expect(s.context.feedback["a"]?.settled).toBe(true);
    expect(s.context.at).toBe(1);
    const back = after(s, { type: "jump", at: 2 }, { type: "entered" }, { type: "settle" });
    expect(back.context.feedback["c"]?.settled).toBe(true);
    expect(back.context.at).toBe(1);
  });

  it("passes over settled steps on its way back", () => {
    const s = after(
      ready(),
      { type: "jump", at: 1 },
      { type: "entered" },
      { type: "settle" },
      { type: "entered" },
      { type: "settle" },
    );
    expect(s.context.feedback["c"]?.settled).toBe(true);
    expect(s.context.at).toBe(0);
  });

  it("goes back with h to the step just settled, and H passes over it", () => {
    const s = after(ready(), { type: "settle" }, { type: "entered" }, { type: "go", by: -1 });
    expect(s.context.at).toBe(0);
    expect(s.context.feedback["a"]?.settled).toBe(true);
    const open = after(ready(), { type: "settle" }, { type: "entered" });
    expect(after(open, { type: "go", by: -1, open: true }).context.at).toBe(1);
    expect(after(open, { type: "go", by: 1, open: true }).context.at).toBe(2);
  });

  it("is settled when the agent settles the step's note", () => {
    const s = after(asked(), {
      type: "replies",
      replies: { [note]: { state: "replied", settled: true, replies: [{ text: "Done" }] } },
    });
    expect(s.context.feedback["a"]?.settled).toBe(true);
  });

  it("is settled when the agent settles an answered note later, after Y and a new message", () => {
    const done = { text: "Done" };
    const s = after(
      asked(),
      { type: "replies", replies: { [note]: { state: "replied", replies: [done] } } },
      { type: "settle" },
      { type: "write", id: note, step: "a", draft: "One more" },
      { type: "send", id: note, step: "a", at: 2 },
      { type: "replies", replies: { [note]: { state: "replied", replies: [done, done] } } },
      {
        type: "replies",
        replies: { [note]: { state: "replied", settled: true, replies: [done, done] } },
      },
    );
    expect(s.context.notes.find((n) => n.id === note)?.state).toBe("settled");
    expect(s.context.feedback["a"]?.settled).toBe(true);
  });

  it("is not settled again by an old settle once the reviewer wrote after it", () => {
    const done = { text: "Done" };
    const settled = { state: "replied", settled: true, settledAt: 1.5 } as const;
    const s = after(
      asked(),
      { type: "replies", replies: { [note]: { ...settled, replies: [done] } } },
      { type: "write", id: note, step: "a", draft: "One more" },
      { type: "send", id: note, step: "a", at: 2 },
      { type: "replies", replies: { [note]: { ...settled, replies: [done] } } },
    );
    expect(s.context.notes.find((n) => n.id === note)?.state).toBe("waiting");
    expect(s.context.feedback["a"]?.settled).toBe(false);
    const answered = after(s, {
      type: "replies",
      replies: { [note]: { ...settled, replies: [done, { text: "Again" }] } },
    });
    expect(answered.context.notes.find((n) => n.id === note)?.state).toBe("replied");
    const now = after(answered, {
      type: "replies",
      replies: { [note]: { ...settled, settledAt: 3, replies: [done, { text: "Again" }] } },
    });
    expect(now.context.feedback["a"]?.settled).toBe(true);
  });

  it("shows the agent's answer on a settled note, and keeps it settled", () => {
    const s = after(
      asked(),
      { type: "settle" },
      {
        type: "replies",
        replies: { [note]: { state: "replied", replies: [{ text: "Noted" }] } },
      },
    );
    const n = s.context.notes.find((o) => o.id === note);
    expect(n?.state).toBe("settled");
    expect(n?.thread.at(-1)?.text).toBe("Noted");
  });
});

describe("the verdicts on a part's variants", () => {
  const drop = (variant: string): Event => ({ type: "drop", part: "Suggestion", variant });
  const settle = (variant: string): Event => ({
    type: "settle",
    keep: { part: "Suggestion", variant },
  });
  const on = (s: Snapshot) => s.context.feedback["a"]?.parts?.["Suggestion"];

  it("keeps the variant shown when the step settles, and none when it opens again", () => {
    const s = after(start(true), { type: "entered" }, drop("Marked"), settle("Card"));
    expect(s.context.feedback["a"]?.settled).toBe(true);
    expect(on(s)).toEqual({ kept: ["Card"], dropped: ["Marked"] });
    // The settle went on: the reviewer comes back to the step to open it again.
    const opened = after(s, { type: "jump", at: 0 }, { type: "entered" }, { type: "settle" });
    expect(on(opened)).toEqual({ kept: [], dropped: ["Marked"] });
    expect(on(after(opened, settle("Tracked")))).toEqual({
      kept: ["Tracked"],
      dropped: ["Marked"],
    });
  });

  it("takes a settle's keep back with undo", () => {
    const s = after(start(true), { type: "entered" }, settle("Card"), { type: "undo" });
    expect(on(s)).toBeUndefined();
  });

  it("takes a delete back with undo, and does it again with redo", () => {
    const dropped = after(start(true), drop("Marked"));
    const undone = after(dropped, { type: "undo" });
    expect(on(undone)).toBeUndefined();
    expect(on(after(undone, { type: "redo" }))).toEqual({ kept: [], dropped: ["Marked"] });
  });

  it("keeps a note on a variant as a pointed note of the step", () => {
    const variantPin = {
      what: "Tracked change, a variant of Suggestion",
      selector: '[data-blueline-part="Suggestion"]',
      variant: { part: "Suggestion", variant: "Tracked change" },
    };
    const s = after(start(true), { type: "point", id: "v1", pin: variantPin });
    expect(s.context.opened).toBe("v1");
    expect(s.context.notes.find((n) => n.id === "v1")?.pin?.variant?.variant).toBe(
      "Tracked change",
    );
  });
});

describe("notes on a page, off a step", () => {
  const place = "place:/pursuits";
  const page = () => after(start(), { type: "place", place });
  const pin = { what: "the header", selector: "h1" };

  it("puts a pointed note on the page, as a draft the next message sends", () => {
    const pointed = after(page(), { type: "point", id: "p1", pin });
    expect(pointed.matches({ layer: "pinned" })).toBe(true);
    const draft = after(
      pointed,
      { type: "write", id: "p1", step: place, pin, draft: "Smaller" },
      { type: "close" },
    );
    expect(draft.context.notes.find((n) => n.id === "p1")).toMatchObject({
      step: place,
      state: "new",
    });
    const sent = after(draft, {
      type: "send",
      id: stepNoteId(place),
      step: place,
      at: 1,
      text: "",
    });
    expect(sent.context.notes.find((n) => n.id === stepNoteId(place))?.state).toBe("waiting");
  });

  it("points at nothing with no page and no step", () => {
    expect(after(start(), { type: "point", id: "p1", pin }).matches({ layer: "pinned" })).toBe(
      false,
    );
  });

  it("opens and closes the page's card", () => {
    const open = after(page(), { type: "page", open: true });
    expect(open.context.page).toBe(true);
    expect(after(open, { type: "page" }).context.page).toBe(false);
  });
});

describe("one chat for each step and page", () => {
  const ready = () => after(start(), { type: "choose" }, { type: "entered" });
  const chat = stepNoteId("a");
  const pointed = (s: Snapshot) =>
    after(
      s,
      { type: "point", id: "p1", pin },
      { type: "write", id: "p1", step: "a", pin, draft: "Bolder" },
      { type: "close" },
    );

  it("sends the pointed notes in the chat's message, and keeps them no more", () => {
    const s = after(pointed(ready()), { type: "send", id: chat, step: "a", at: 5, text: "Look" });
    const notes = s.context.notes;
    expect(notes.some((n) => n.id === "p1")).toBe(false);
    const message = notes.find((n) => n.id === chat)?.thread.at(-1);
    expect(message).toMatchObject({ text: "Look", pins: [{ id: "p1", pin, text: "Bolder" }] });
  });

  it("sends the pointed notes alone, as a message with no words", () => {
    const s = after(pointed(ready()), { type: "send", id: chat, step: "a", at: 5, text: "" });
    const message = s.context.notes.find((n) => n.id === chat)?.thread.at(-1);
    expect(message).toMatchObject({ text: "", pins: [{ id: "p1", text: "Bolder" }] });
  });

  it("puts the pointed notes back when the dev server does not take the message", () => {
    let s = after(pointed(ready()), { type: "write", id: chat, step: "a", draft: "Look" });
    s = after(s, { type: "send", id: chat, step: "a", at: 5 }, { type: "failed", ids: [chat] });
    expect(s.context.notes.find((n) => n.id === chat)).toMatchObject({ thread: [], draft: "Look" });
    expect(s.context.notes.find((n) => n.id === "p1")).toMatchObject({ draft: "Bolder", pin });
  });

  it("answers in the chat, also for its pointed notes", () => {
    const s = after(
      pointed(ready()),
      { type: "send", id: chat, step: "a", at: 5, text: "" },
      {
        type: "replies",
        replies: { [chat]: { state: "replied", replies: [{ text: "Bolder now" }] } },
      },
    );
    const thread = s.context.notes.find((n) => n.id === chat)?.thread ?? [];
    expect(thread.map((m) => m.by)).toEqual(["you", "agent"]);
  });

  it("writes to the page from a step, and goes back to the step's chat on a step chosen", () => {
    const page = initialTransition(sessionMachine, {
      kept: { ...START, journey: "prep" },
      journeys: JOURNEYS,
      now: 0,
      place: "place:/request",
    })[0];
    let s = after(page, { type: "choose" }, { type: "entered" }, { type: "point", id: "p1", pin });
    expect(s.context.notes.find((n) => n.id === "p1")?.step).toBe("a");
    s = after(s, { type: "remove", id: "p1" }, { type: "chat" });
    expect(s.context).toMatchObject({ active: true, chat: "page" });
    s = after(s, { type: "point", id: "p2", pin });
    expect(s.context.notes.find((n) => n.id === "p2")?.step).toBe("place:/request");
    s = after(s, { type: "close" }, { type: "go", by: 1 });
    expect(s.context.chat).toBe("page");
    expect(after(s, { type: "jump", at: 0 }).context.chat).toBe("step");
    expect(after(s, { type: "chat" }).context.chat).toBe("step");
  });

  it("leaves the step for the page, where the walk stops", () => {
    const s = after(ready(), { type: "go", by: 1 }, { type: "entered" }, { type: "leave" });
    expect(s.matches({ review: "off" })).toBe(true);
    expect(s.context).toMatchObject({ active: false, at: 1 });
  });
});
