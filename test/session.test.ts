import { describe, expect, it } from "vitest";
import {
  createActor,
  createCallbackLogic,
  initialTransition,
  transition,
  type SnapshotFrom,
} from "xstate";
import { isWithAgent } from "../src/notes/note";
import {
  sessionMachine,
  stepNoteId,
  postId,
  treeShown,
  type EnterInput,
  type Event,
  type Post,
} from "../src/session/machine";
import { keptOf } from "../src/io/storage";
import { handoffId, handoffStep } from "../src/notes/handoff";
import { postedLine } from "../src/session/lines";
import { START, type Feedback, type Shape } from "../src/session/state";
import type { DevJourney } from "../src/types";

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

const after = (snapshot: Snapshot, ...events: readonly Event[]) =>
  events.reduce((s, e) => transition(sessionMachine, s, e)[0], snapshot);

/** The session as a page loads it; off a review the reviewer shows the panel, as Ctrl+B does,
 * since the tools start idle there. */
const start = (active = false): Snapshot =>
  after(
    initialTransition(sessionMachine, {
      kept: { ...START, journey: "prep", active },
      journeys: JOURNEYS,
      now: 0,
    })[0],
    { type: "panel", shown: true },
  );

const pin = { what: "the “Safety” field", selector: "#safety" };

const ALPHABET: readonly Event[] = [
  { type: "leave" },
  { type: "chat" },
  { type: "go", by: 1 },
  { type: "go", by: -1 },
  { type: "go", by: 1, open: true },
  { type: "variant", by: 1 },
  { type: "peek", step: "b", label: "Three" },
  { type: "peek", step: "b", label: undefined },
  { type: "entered" },
  { type: "switched" },
  { type: "panel" },
  { type: "tree" },
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
  { type: "reopen" },
  { type: "finish" },
  { type: "back" },
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

  it("keeps the panel's region and its flag as one, and no tree unfolded in a hidden panel", () => {
    for (const { snapshot, path } of all) {
      const { panel, tree } = snapshot.context;
      expect(snapshot.matches({ panel: panel ? "shown" : "hidden" }), why(path)).toBe(true);
      expect(!panel && tree, why(path)).toBe(false);
    }
  });

  it("shows the panel each time the reviewer leaves a step", () => {
    for (const { snapshot, path } of all) {
      if (!snapshot.context.active) continue;
      expect(after(snapshot, { type: "leave" }).context.panel, why(path)).toBe(true);
    }
  });

  it("keeps the step and the tree's selection on the journey", () => {
    for (const { snapshot, path } of all) {
      const { at, cursor } = snapshot.context;
      expect(at >= 0 && at <= 2 && cursor >= 0 && cursor <= 2, why(path)).toBe(true);
    }
  });

  it("selects the step in the tree each time the walk goes to another one", () => {
    for (const { snapshot, path } of reachable(4)) {
      for (const event of ALPHABET) {
        const next = after(snapshot, event);
        if (!next.context.active || next.context.at === snapshot.context.at) continue;
        expect(
          { cursor: next.context.cursor, row: next.context.row },
          why([...path, event]),
        ).toEqual({ cursor: next.context.at, row: undefined });
      }
    }
  });

  it("is ready only when the page shows the step and the variant the session says", () => {
    for (const { snapshot, path } of all) {
      if (!snapshot.matches({ review: { on: "ready" } })) continue;
      const { entered, at, variants, journey, peek } = snapshot.context;
      const step = JOURNEYS[0]?.steps[at];
      // The variant it shows for now, else the one it keeps.
      const variant = peek?.step === step?.id ? peek?.index : (variants[step?.id ?? ""] ?? 0);
      expect(entered, why(path)).toEqual(expect.objectContaining({ journey, at, variant }));
    }
  });

  it("shows a variant for now only on the step it is on, in a walk", () => {
    for (const { snapshot, path } of all) {
      const { peek, active, at } = snapshot.context;
      if (peek === undefined) continue;
      expect(active, why(path)).toBe(true);
      expect(peek.step, why(path)).toBe(JOURNEYS[0]?.steps[at]?.id);
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

  describe("a variant the step shows for now (peek)", () => {
    /** On step b, open and ready. */
    const onB = () =>
      after(
        start(),
        { type: "choose" },
        { type: "entered" },
        { type: "go", by: 1 },
        {
          type: "entered",
        },
      );

    it("shows it, and goes back to the one the step keeps", () => {
      let s = after(onB(), { type: "peek", step: "b", label: "Three" });
      expect(s.matches({ review: { on: "switching" } })).toBe(true);
      expect(s.context.opening?.variant).toBe(2);
      s = after(s, { type: "switched" });
      expect(s.matches({ review: { on: "ready" } })).toBe(true);
      expect(s.context.variants["b"]).toBeUndefined();
      s = after(s, { type: "peek", step: "b", label: undefined });
      expect(s.context.opening?.variant).toBe(0);
      s = after(s, { type: "switched" });
      expect(s.matches({ review: { on: "ready" } })).toBe(true);
    });

    it("starts a running switch again when the variant asked for changes", () => {
      let s = after(onB(), { type: "peek", step: "b", label: "Two" });
      const [next, actions] = transition(sessionMachine, s, {
        type: "peek",
        step: "b",
        label: undefined,
      });
      s = next;
      expect(s.matches({ review: { on: "switching" } })).toBe(true);
      expect(s.context.opening?.variant).toBe(0);
      // The running switch stops, so its signal aborts, and a new one starts.
      const kinds = actions.map((a) => a.type);
      expect(kinds).toContain("@xstate.stop");
      expect(kinds).toContain("@xstate.spawn");
    });

    it("ends when a step opens, and the step comes back on the variant it keeps", () => {
      let s = after(onB(), { type: "variant", by: 1 }, { type: "switched" });
      s = after(s, { type: "peek", step: "b", label: "Three" }, { type: "go", by: 1 });
      expect(s.context.peek).toBeUndefined();
      s = after(s, { type: "entered" }, { type: "go", by: -1 });
      expect(s.context.opening?.variant).toBe(1);
    });

    it("ends when the walk leaves, and a peek at another step's variant does nothing", () => {
      let s = after(onB(), { type: "peek", step: "c", label: "Y" });
      expect(s.context.peek).toBeUndefined();
      s = after(s, { type: "peek", step: "b", label: "Two" }, { type: "leave" });
      expect(s.context.peek).toBeUndefined();
    });

    it("clears the step's trouble when a switch starts, so a failure is the new variant's", () => {
      let s = after(onB(), { type: "trouble", step: "b", reason: "setup failed" });
      s = after(s, { type: "peek", step: "b", label: "Two" });
      expect(s.context.trouble["b"]).toBeUndefined();
    });
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

  it("opens the step selected in the tree, also when no review runs", () => {
    const s = after(
      start(),
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

  it("selects the open steps in the tree with Ctrl+J and Ctrl+K", () => {
    const settled = after(
      initialTransition(sessionMachine, {
        kept: { ...START, journey: "prep", feedback: { b: { settled: true } } },
        journeys: JOURNEYS,
        now: 0,
      })[0],
      { type: "panel", shown: true },
    );
    const down = after(settled, { type: "cursorOpen", by: 1 });
    expect(down.context.cursor).toBe(2);
    expect(after(down, { type: "cursorOpen", by: 1 }).context.cursor).toBe(2);
    expect(after(down, { type: "cursorOpen", by: -1 }).context.cursor).toBe(0);
  });

  it("keeps the tree's open and closed rows, which a reload keeps", () => {
    const open = after(
      start(),
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
    expect(actions.some((a) => a.type === "@xstate.spawn")).toBe(true);
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
        post: createCallbackLogic<Event, Post>(({ sendBack, self }) => {
          posts += 1;
          sendBack({ type: "posted", child: postId(self) });
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
    // A working state from before the next message is no answer to it: the message waits.
    const again = after(replied, { type: "send", id, step: "a", at: 10, text: "Bolder" });
    const old = after(again, {
      type: "replies",
      replies: { [id]: { state: "working", workingAt: 5, replies: [{ text: "Bold now", at: 6 }] } },
    });
    expect(chat(old)?.state).toBe("waiting");
    const taken = after(again, {
      type: "replies",
      replies: {
        [id]: { state: "working", workingAt: 11, replies: [{ text: "Bold now", at: 6 }] },
      },
    });
    expect([chat(taken)?.state, chat(taken)?.workingSince]).toEqual(["working", 11]);
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

  it("draws the agent's replies by their time, so old ones never answer a new message", () => {
    const id = stepNoteId("b");
    const chat = (s: Snapshot) => s.context.notes.find((n) => n.id === id);
    // The page lost the chat of two days ago; the status file keeps its three replies.
    const old = [
      { text: "Too short, sorry", at: 10 },
      { text: "Bold now", at: 20 },
      { text: "Done", at: 30 },
    ];
    let s = after(
      start(),
      { type: "choose" },
      { type: "entered" },
      { type: "go", by: 1 },
      { type: "entered" },
      { type: "write", id, step: "b", draft: "Highlight the route" },
      { type: "send", id, step: "b", at: 100 },
      { type: "replies", replies: { [id]: { state: "working", replies: old } } },
    );
    expect(chat(s)?.thread.map((m) => m.text)).toEqual([
      "Too short, sorry",
      "Bold now",
      "Done",
      "Highlight the route",
    ]);
    expect([chat(s)?.state, chat(s)?.unread]).toEqual(["working", false]);
    s = after(s, {
      type: "replies",
      replies: { [id]: { state: "replied", replies: [...old, { text: "Highlighted", at: 110 }] } },
    });
    expect(
      chat(s)
        ?.thread.map((m) => m.text)
        .slice(-2),
    ).toEqual(["Highlight the route", "Highlighted"]);
    expect([chat(s)?.state, chat(s)?.unread]).toEqual(["replied", true]);
    // A status file from before replies had times reads as before: by count, under the chat.
    const untimed = after(
      start(),
      { type: "choose" },
      { type: "entered" },
      { type: "go", by: 1 },
      { type: "entered" },
      { type: "write", id, step: "b", draft: "Ask" },
      { type: "send", id, step: "b", at: 100 },
      { type: "replies", replies: { [id]: { state: "replied", replies: [{ text: "Yes" }] } } },
    );
    expect(chat(untimed)?.thread.map((m) => [m.text, m.at])).toEqual([
      ["Ask", 100],
      ["Yes", 100],
    ]);
  });

  it("never puts an old reply between a step's first note and the next message", () => {
    const id = stepNoteId("b");
    const chat = (s: Snapshot) => s.context.notes.find((n) => n.id === id);
    // The reply answered the step's chat two days ago; the listener gave it the time before
    // every chat (bin/lines.ts, `dated`).
    const old = { text: "Done: five designs", at: 0 };
    const s = after(
      start(),
      { type: "choose" },
      { type: "entered" },
      { type: "go", by: 1 },
      { type: "entered" },
      { type: "write", id, step: "b", draft: "How do I get into this menu?" },
      { type: "send", id, step: "b", at: 100 },
      { type: "replies", replies: { [id]: { state: "working", replies: [old] } } },
      { type: "write", id, step: "b", draft: "Again, this is a bug" },
      { type: "send", id, step: "b", at: 120 },
      { type: "replies", replies: { [id]: { state: "working", replies: [old] } } },
    );
    expect(chat(s)?.thread.map((m) => m.text)).toEqual([
      "Done: five designs",
      "How do I get into this menu?",
      "Again, this is a bug",
    ]);
    expect(chat(s)?.state).toBe("working");
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

describe("a settle from the tree", () => {
  it("settles the selected step, and moves the walk and the selection on", () => {
    let s = after(start(), { type: "choose" }, { type: "entered" });
    s = after(s, { type: "settle", step: 1 });
    expect(s.context.feedback["b"]?.settled).toBe(true);
    expect(s.context.feedback["a"]?.settled).toBeUndefined();
    expect(s.context.at).toBe(2);
    expect(s.context.cursor).toBe(2);
    // y again on the settled step opens it again, and the walk and the selection stay.
    s = after(s, { type: "entered" }, { type: "cursor", by: -1 }, { type: "reopen", step: 1 });
    expect(s.context.feedback["b"]?.settled).toBe(false);
    expect(s.context.cursor).toBe(1);
    expect(s.context.at).toBe(2);
    expect(after(s, { type: "undo" }).context.feedback["b"]?.settled).toBe(true);
  });

  it("goes on from the step the page shows, as y on the page does", () => {
    const open = after(start(), { type: "choose" }, { type: "entered" });
    expect(open.context.cursor).toBe(open.context.at);
    const s = after(open, { type: "settle", step: open.context.at });
    expect(s.context.feedback["a"]?.settled).toBe(true);
    expect(s.context.at).toBe(1);
    expect(s.context.cursor).toBe(1);
    expect(s.context.chat).toBe(open.context.chat);
  });

  it("goes back to the first open step when none is after, as the dashboard's walk showed", () => {
    // Settled from the tree: a and b are open, so the walk goes to a, not to b.
    let s = after(start(), { type: "choose" }, { type: "entered" });
    s = after(s, { type: "settle", step: 2 });
    expect(s.context.feedback["c"]?.settled).toBe(true);
    expect(s.context.at).toBe(0);
    expect(s.context.cursor).toBe(0);
    // Settled on the page, from the last step.
    const last = after(start(), { type: "choose" }, { type: "entered" }, { type: "jump", at: 2 });
    const on = after(last, { type: "entered" }, { type: "settle" });
    expect(on.context.feedback["c"]?.settled).toBe(true);
    expect(on.context.at).toBe(0);
    expect(on.context.cursor).toBe(0);
  });

  it("undoes the settle back to the step the page showed", () => {
    let s = after(start(), { type: "choose" }, { type: "entered" });
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

  it("holds the last settle until the reviewer finishes: the panel shows the finish, and nothing goes yet", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    expect(s.matches({ review: "on" })).toBe(true);
    expect(s.context.at).toBe(2);
    const posts = s.context.posts;
    const held = after(s, { type: "entered" }, { type: "panel" }, { type: "settle" });
    expect(held.context.feedback["c"]?.settled).toBe(true);
    expect(held.context.finish).toEqual({ step: "c", ids: [] });
    // The walk stays on the step, and the panel shows to ask.
    expect(held.matches({ review: "on" })).toBe(true);
    expect(held.context).toMatchObject({ active: true, panel: true, at: 2 });
    expect(held.context.posts).toBe(posts);
  });

  it("ends the review on finish: the held settle goes, the tools show the page, and the walk stays on the step", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const held = after(s, { type: "entered" }, { type: "settle" });
    const done = after(held, { type: "finish" });
    expect(done.matches({ review: "off", panel: "shown" })).toBe(true);
    // The panel goes back to the page with the tree, and holds no hand-off.
    expect(done.context).toMatchObject({
      active: false,
      panel: true,
      tree: true,
      handoff: null,
      row: "journey:prep",
      at: 2,
    });
    expect(done.context.finish).toBeNull();
    expect(done.context.posts).toBe(held.context.posts + 1);
    // Finish does nothing when nothing waits for it.
    expect(after(s, { type: "finish" }).context).toEqual(s.context);
  });

  it("holds the last settle also when the tree settles the last open step", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const held = after(s, { type: "entered" }, { type: "settle", step: 2 });
    expect(held.context.feedback["c"]?.settled).toBe(true);
    expect(held.context.finish).toEqual({ step: "c", ids: [] });
    expect(held.context).toMatchObject({ panel: true, at: 2, cursor: 2 });
  });

  it("holds the notes that go with the last settle, and sends them on finish", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const note = stepNoteId("c");
    const held = after(
      s,
      { type: "entered" },
      { type: "write", id: note, step: "c", draft: "Make it bold" },
      { type: "settle", at: 5 },
    );
    expect(held.context.finish).toEqual({ step: "c", ids: [note] });
    expect(after(held, { type: "finish" }).context.posts).toBe(held.context.posts + 1);
  });

  it("goes back from the finish with undo: the last step opens again, and nothing went", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const held = after(s, { type: "entered" }, { type: "settle" });
    const back = after(held, { type: "undo" });
    expect(back.context.feedback["c"]?.settled).toBeUndefined();
    expect(back.context.finish).toBeNull();
    expect(back.matches({ review: "on" })).toBe(true);
    expect(back.context).toMatchObject({ active: true, at: 2, posts: held.context.posts });
  });

  it("goes back from the finish with Back as with undo", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const held = after(s, { type: "entered" }, { type: "settle" });
    expect(after(held, { type: "back" }).context).toEqual(after(held, { type: "undo" }).context);
    // Back does nothing when nothing waits.
    expect(after(s, { type: "back" }).context).toEqual(s.context);
  });

  it("goes back from the finish after a reload, with no undo: the step opens, and the notes held go", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const note = stepNoteId("c");
    const held = after(
      s,
      { type: "entered" },
      { type: "write", id: note, step: "c", draft: "Make it bold" },
      { type: "settle", at: 5 },
    );
    const reloaded = after(
      initialTransition(sessionMachine, {
        kept: keptOf(held.context),
        journeys: JOURNEYS,
        now: 0,
      })[0],
      { type: "entered" },
    );
    const back = after(reloaded, { type: "back" });
    expect(back.context.finish).toBeNull();
    expect(back.context.feedback["c"]?.settled).toBe(false);
    expect(back.context).toMatchObject({ active: true, at: 2 });
    // The agent never heard of the settle; the notes shown as sent go now.
    expect(back.context.posts).toBe(reloaded.context.posts + 1);
  });

  it("keeps the finish through a reload", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const held = after(s, { type: "entered" }, { type: "settle" });
    expect(keptOf(held.context).finish).toEqual({ step: "c", ids: [] });
    const reloaded = initialTransition(sessionMachine, {
      kept: keptOf(held.context),
      journeys: JOURNEYS,
      now: 0,
    })[0];
    expect(reloaded.context.finish).toEqual({ step: "c", ids: [] });
    expect(reloaded.context.active).toBe(true);
  });

  it("tells the tools the journey is done, on finish", () => {
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
    expect(done).toEqual([]);
    actor.send({ type: "finish" });
    expect(done).toEqual(["prep"]);
    actor.stop();
  });

  it("makes the hand-off on finish, named by its time, and leaves it to the tree's row", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const held = after(s, { type: "entered" }, { type: "settle" });
    const done = after(held, { type: "finish", at: 77 });
    const id = handoffId("prep", 77);
    expect(done.context).toMatchObject({ active: false, panel: true, handoff: null });
    expect(done.context.notes.find((n) => n.id === id)).toMatchObject({
      step: handoffStep("prep"),
      state: "waiting",
      thread: [],
    });
    // The page reads the agent's answer while the hand-off waits for it.
    expect(done.matches({ agent: "polling" })).toBe(true);
    expect(keptOf(done.context).handoff).toBeNull();
    // The journey's row opens the hand-off; Done goes back to the tree.
    const opened = after(done, { type: "handoff", id });
    expect(opened.context).toMatchObject({ active: false, handoff: id });
    expect(after(opened, { type: "handoff", id: null }).context.handoff).toBeNull();
  });

  it("shows a reply to a finished review as news, and opens nothing", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const done = after(s, { type: "entered" }, { type: "settle" }, { type: "finish", at: 1 });
    const id = handoffId("prep", 1);
    const replied = after(done, {
      type: "replies",
      replies: { [id]: { state: "replied", replies: [{ text: "Applied both parts." }] } },
    });
    expect(replied.context).toMatchObject({ active: false, handoff: null });
    expect(replied.context.notes.find((n) => n.id === id)).toMatchObject({
      state: "replied",
      unread: true,
    });
  });

  it("names the hand-off in the settle that Finish sends, and in no other line", () => {
    const sent: Post[] = [];
    const machine = sessionMachine.provide({
      actors: {
        post: createCallbackLogic<Event, Post>(({ input, sendBack, self }) => {
          for (let post: Post | undefined = input; post !== undefined; post = post.next)
            sent.push(post);
          sendBack({ type: "posted", child: postId(self) });
        }),
      },
    });
    const actor = createActor(machine, {
      input: {
        kept: {
          ...START,
          journey: "prep",
          active: true,
          at: 1,
          feedback: { a: { settled: true } },
        },
        journeys: JOURNEYS,
        now: 0,
      },
    }).start();
    actor.send({ type: "entered" });
    actor.send({ type: "settle" });
    actor.send({ type: "entered" });
    actor.send({ type: "settle" });
    actor.send({ type: "finish", at: 5 });
    expect(sent.map((p) => [p.step, p.handoff])).toEqual([
      ["b", undefined],
      ["c", handoffId("prep", 5)],
    ]);
    actor.stop();
  });

  it("shows the agent's plan and then its reply on the hand-off", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const done = after(s, { type: "entered" }, { type: "settle" }, { type: "finish", at: 1 });
    const id = handoffId("prep", 1);
    const plan = [
      {
        kind: "plan" as const,
        items: [{ text: "Apply the kept variants", state: "doing" as const }],
      },
    ];
    const working = after(done, {
      type: "replies",
      replies: { [id]: { state: "working", progress: plan } },
    });
    expect(working.context.notes.find((n) => n.id === id)).toMatchObject({
      state: "working",
      progress: plan,
    });
    const replied = after(working, {
      type: "replies",
      replies: { [id]: { state: "replied", replies: [{ text: "Applied both parts." }] } },
    });
    const note = replied.context.notes.find((n) => n.id === id);
    expect(note).toMatchObject({ state: "replied", unread: true, progress: undefined });
    expect(note?.thread.map((m) => [m.by, m.text])).toEqual([["agent", "Applied both parts."]]);
    // The row opens the hand-off. Done leaves it for the tree, and the answer read there is
    // done with.
    const left = after(replied, { type: "handoff", id }, { type: "handoff", id: null });
    expect(left.context.handoff).toBeNull();
    expect(left.context.notes.find((n) => n.id === id)?.state).toBe("settled");
  });

  it("keeps a hand-off that the agent still works on when Done leaves it", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const done = after(s, { type: "entered" }, { type: "settle" }, { type: "finish", at: 1 });
    const left = after(done, { type: "handoff", id: null });
    expect(left.context.handoff).toBeNull();
    expect(left.context.notes.find((n) => n.id === handoffId("prep", 1))?.state).toBe("waiting");
    // It shows again on request, as the tree's row or a reply's toast asks.
    expect(after(left, { type: "handoff", id: handoffId("prep", 1) }).context.handoff).toBe(
      handoffId("prep", 1),
    );
  });

  it("keeps the hand-off through a reload, and leaves it when a journey starts", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const done = after(
      s,
      { type: "entered" },
      { type: "settle" },
      { type: "finish", at: 1 },
      { type: "handoff", id: handoffId("prep", 1) },
    );
    const reloaded = initialTransition(sessionMachine, {
      kept: keptOf(done.context),
      journeys: JOURNEYS,
      now: 0,
    })[0];
    expect(reloaded.context).toMatchObject({ active: false, handoff: handoffId("prep", 1) });
    const again = after(reloaded, {
      type: "start",
      journey: "prep",
      at: 0,
      fresh: false,
      again: true,
    });
    expect(again.context.handoff).toBeNull();
    // u after Finish opens the last step again, off the hand-off.
    expect(after(done, { type: "undo" }).context).toMatchObject({ active: true, handoff: null });
  });

  it("goes back to the step from the page when u takes the last settle back", () => {
    const s = after(lastOpen(), { type: "go", by: -1 }, { type: "entered" }, { type: "settle" });
    const done = after(s, { type: "entered" }, { type: "settle" }, { type: "finish" });
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
      { type: "finish" },
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

  it("opens the step again from the menu, or with a new message", () => {
    const settled = after(asked(), { type: "settle" });
    const again = after(settled, { type: "jump", at: 0 }, { type: "entered" }, { type: "reopen" });
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

  it("opens a settled step again with y, and stays on it, as Open the step again does", () => {
    const settled = after(ready(), { type: "settle" }, { type: "entered" });
    const back = after(settled, { type: "go", by: -1 }, { type: "entered" });
    const toggled = after(back, { type: "settle" });
    const reopened = after(back, { type: "reopen" });
    expect(toggled.context.at).toBe(0);
    expect(toggled.context.feedback["a"]?.settled).toBe(false);
    expect(toggled.context.feedback).toEqual(reopened.context.feedback);
    expect(toggled.context.past.at(-1)?.label).toBe("Opened the step again");
    // y again settles it again.
    expect(after(toggled, { type: "settle" }).context.feedback["a"]?.settled).toBe(true);
  });

  it("goes on to the next open step, or back to the first open one when none is after", () => {
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
    const opened = after(s, { type: "jump", at: 0 }, { type: "entered" }, { type: "reopen" });
    expect(on(opened)).toEqual({ kept: [], dropped: ["Marked"] });
    expect(on(after(opened, settle("Tracked")))).toEqual({
      kept: ["Tracked"],
      dropped: ["Marked"],
    });
  });

  it("keeps the step's own variant shown when the step settles, and none when it opens again", () => {
    const onB = after(start(true), { type: "entered" }, { type: "go", by: 1 }, { type: "entered" });
    const s = after(onB, { type: "variant", by: 1 }, { type: "switched" }, { type: "settle" });
    expect(s.context.feedback["b"]).toMatchObject({ settled: true, variant: "Two" });
    const opened = after(s, { type: "jump", at: 1 }, { type: "entered" }, { type: "reopen" });
    expect(opened.context.feedback["b"]?.settled).toBe(false);
    expect(opened.context.feedback["b"]?.variant).toBeUndefined();
  });

  it("keeps another variant on a settled step: the old one is kept no more", () => {
    const s = after(start(true), { type: "entered" }, drop("Marked"), settle("Card"));
    const back = after(s, { type: "jump", at: 0 }, { type: "entered" });
    const changed = after(back, settle("Tracked"));
    expect(changed.context.feedback["a"]?.settled).toBe(true);
    expect(on(changed)).toEqual({ kept: ["Tracked"], dropped: ["Marked"] });
    expect(changed.context.posts).toBe(back.context.posts + 1);
    // It goes on, as a settle does, and u takes it back to the old one.
    expect(changed.context.at).toBe(1);
    expect(changed.context.past.at(-1)?.label).toBe("Kept Tracked");
    const undone = after(changed, { type: "undo" });
    expect(on(undone)).toEqual({ kept: ["Card"], dropped: ["Marked"] });
    expect(undone.context.feedback["a"]?.settled).toBe(true);
    expect(undone.context.at).toBe(0);
  });

  it("keeps another own variant on a settled step", () => {
    const onB = after(start(true), { type: "entered" }, { type: "go", by: 1 }, { type: "entered" });
    const s = after(onB, { type: "variant", by: 1 }, { type: "switched" }, { type: "settle" });
    const back = after(s, { type: "entered" }, { type: "go", by: -1 }, { type: "entered" });
    const changed = after(
      back,
      { type: "variant", by: 1 },
      { type: "switched" },
      { type: "settle" },
    );
    expect(changed.context.feedback["b"]).toMatchObject({ settled: true, variant: "Three" });
    expect(changed.context.posts).toBe(back.context.posts + 1);
  });

  it("shows the kept variant on a settled step it arrives at", () => {
    const onB = after(start(true), { type: "entered" }, { type: "go", by: 1 }, { type: "entered" });
    const s = after(onB, { type: "variant", by: 1 }, { type: "switched" }, { type: "settle" });
    // Back on b, the reviewer shows Three, then leaves and comes back: Two shows again.
    const back = after(s, { type: "entered" }, { type: "go", by: -1 }, { type: "entered" });
    const three = after(back, { type: "variant", by: 1 }, { type: "switched" });
    expect(three.context.variants["b"]).toBe(2);
    const again = after(three, { type: "go", by: 1 }, { type: "entered" }, { type: "go", by: -1 });
    expect(again.context.variants["b"]).toBe(1);
    expect(again.context.opening).toMatchObject({ at: 1, variant: 1 });
  });

  it("tells the step it opens which part variants its settle kept, so the page shows them", () => {
    const inputs: EnterInput[] = [];
    const machine = sessionMachine.provide({
      actors: {
        enterStep: createCallbackLogic<Event, EnterInput>(({ input }) => {
          inputs.push(input);
        }),
      },
    });
    const actor = createActor(machine, {
      input: { kept: { ...START, journey: "prep", active: true }, journeys: JOURNEYS, now: 0 },
    }).start();
    actor.send({ type: "entered" });
    actor.send(settle("Card"));
    actor.send({ type: "entered" });
    actor.send({ type: "go", by: -1 });
    expect(inputs.at(-1)).toMatchObject({ at: 0, kept: { Suggestion: "Card" } });
    expect(inputs.at(-2)).toMatchObject({ at: 1, kept: {} });
    actor.stop();
  });

  it("keeps no own variant for a step with none", () => {
    const s = after(start(true), { type: "entered" }, { type: "settle" });
    expect(s.context.feedback["a"]?.variant).toBeUndefined();
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

  it("keeps the step's actors running when the reviewer points or pins", () => {
    // XState 5 left the whole parallel machine on a reentry of the layer, so each point
    // restarted the step's and the poll's actors. XState 6 enters the layer again alone.
    const onStep = after(start(true), { type: "entered" });
    expect(onStep.matches({ review: { on: "ready" } })).toBe(true);
    const [pointed, pointing] = transition(sessionMachine, onStep, {
      type: "point",
      id: "p1",
      pin,
    });
    expect(pointed.matches({ layer: "pinned" })).toBe(true);
    const [, pinning] = transition(sessionMachine, pointed, { type: "pin", id: "p1" });
    const restarts = (actions: readonly { readonly type: string }[]) =>
      actions.filter((a) => a.type === "@xstate.spawn" || a.type === "@xstate.stop");
    expect(restarts(pointing)).toEqual([]);
    expect(restarts(pinning)).toEqual([]);
  });

  it("points at nothing with no page and no step", () => {
    expect(after(start(), { type: "point", id: "p1", pin }).matches({ layer: "pinned" })).toBe(
      false,
    );
  });
});

describe("the panel", () => {
  const ready = (kept = {}) =>
    after(
      initialTransition(sessionMachine, {
        kept: { ...START, journey: "prep", ...kept },
        journeys: JOURNEYS,
        now: 0,
      })[0],
      { type: "panel", shown: true },
      { type: "choose" },
      { type: "entered" },
    );
  const reload = (s: Snapshot) =>
    initialTransition(sessionMachine, { kept: keptOf(s.context), journeys: JOURNEYS, now: 0 })[0];

  it("starts hidden off a review, so the tools are idle, and a reload keeps one inside it", () => {
    const loaded = initialTransition(sessionMachine, {
      kept: { ...START, journey: "prep" },
      journeys: JOURNEYS,
      now: 0,
    })[0];
    expect(loaded.matches({ panel: "hidden" })).toBe(true);
    expect(loaded.context.panel).toBe(false);
    // Inside a review, a reload keeps the panel as it was, shown or hidden.
    expect(reload(ready()).matches({ panel: "shown" })).toBe(true);
    expect(reload(after(ready(), { type: "panel" })).matches({ panel: "hidden" })).toBe(true);
    // Off it, a panel left open starts hidden on the next load.
    const left = after(ready(), { type: "leave" });
    expect(left.matches({ review: "off", panel: "shown" })).toBe(true);
    expect(reload(left).matches({ panel: "hidden" })).toBe(true);
  });

  it("hides and shows again with the walk on its step, ready, so the light stays", () => {
    const on = after(ready(), { type: "go", by: 1 }, { type: "entered" });
    const hidden = after(on, { type: "panel" });
    expect(hidden.matches({ review: { on: "ready" }, panel: "hidden" })).toBe(true);
    expect(hidden.context).toMatchObject({ active: true, at: 1, panel: false, preview: false });
    const shown = after(hidden, { type: "panel" });
    expect(shown.matches({ review: { on: "ready" }, panel: "shown" })).toBe(true);
    expect(shown.context).toMatchObject({ active: true, at: 1, cursor: 1, panel: true });
    // A panel already shown stays shown when asked to show, and so does a hidden one.
    expect(after(shown, { type: "panel", shown: true }).context.panel).toBe(true);
    expect(after(hidden, { type: "panel", shown: false }).context.panel).toBe(false);
  });

  it("is left alone by the preview, which hides it only from view", () => {
    const hidden = after(ready(), { type: "panel" });
    expect(after(hidden, { type: "preview" }, { type: "preview" }).context.panel).toBe(false);
    expect(after(ready(), { type: "preview" }, { type: "preview" }).context.panel).toBe(true);
  });

  it("shows the page's chat when the reviewer leaves a step, and the walk stays where it was", () => {
    const left = after(
      ready(),
      { type: "go", by: 1 },
      { type: "entered" },
      { type: "panel" },
      {
        type: "leave",
      },
    );
    expect(left.matches({ review: "off", panel: "shown" })).toBe(true);
    expect(left.context).toMatchObject({ active: false, at: 1, panel: true });
    // The journey opened again goes on there.
    const back = after(left, { type: "start", journey: "prep", at: 1, fresh: false });
    expect(back.context).toMatchObject({ active: true, at: 1 });
  });

  it("folds the tree on each step opened, and when the panel hides", () => {
    const open = after(ready(), { type: "tree" });
    expect(open.context.tree).toBe(true);
    expect(after(open, { type: "tree" }).context.tree).toBe(false);
    expect(after(open, { type: "tree", open: true }).context.tree).toBe(true);
    expect(after(open, { type: "go", by: 1 }).context.tree).toBe(false);
    expect(after(open, { type: "jump", at: 2 }).context.tree).toBe(false);
    expect(after(open, { type: "panel" }).context.tree).toBe(false);
    expect(after(open, { type: "leave" }).context.tree).toBe(false);
    // A hidden panel has no tree to unfold.
    expect(after(ready(), { type: "panel" }, { type: "tree" }).context.tree).toBe(false);
  });

  it("shows the tree off a step on a wide screen, and on a step only unfolded", () => {
    expect(treeShown({ active: false, tree: false }, false)).toBe(true);
    expect(treeShown({ active: true, tree: false }, false)).toBe(false);
    expect(treeShown({ active: true, tree: true }, false)).toBe(true);
    // A phone's sheet keeps it folded off a step too, so the page stays in view.
    expect(treeShown({ active: false, tree: false }, true)).toBe(false);
    expect(treeShown({ active: false, tree: true }, true)).toBe(true);
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

describe("what the agent hears of the settles", () => {
  /**
   * Runs the events on a live session and keeps the agent's view: each settle line it reads
   * says whether its step is settled now, and how many steps are left open. After every event,
   * that view must match the session, but for the last settle, which waits for Finish.
   */
  /** The journeys as the lines name them. */
  const DEV: readonly DevJourney<unknown>[] = JOURNEYS.map((j) => ({
    id: j.id,
    title: j.id,
    steps: j.steps.map((st) => ({
      id: st.id,
      title: st.id,
      look: "",
      group: { id: st.group, title: st.group },
      variants: st.variants.map((label) => ({ label })),
    })),
  }));
  /** What a settle keeps, to compare: the variants of each part, and the step's own. */
  const keptKey = (settled: boolean, parts: unknown, variant: unknown) =>
    settled ? JSON.stringify([parts ?? {}, variant ?? null]) : "open";
  const keptNow = (f: Feedback | undefined) =>
    keptKey(
      f?.settled === true,
      Object.fromEntries(Object.entries(f?.parts ?? {}).map(([p, v]) => [p, v.kept])),
      f?.variant,
    );
  /**
   * Runs the events on a live session and keeps the agent's view: each settle line it reads
   * says whether its step is settled now, what it keeps, and how many steps are left open.
   * After every event, that view must match the session, but for the last settle, which
   * waits for Finish. Each line's `left` must match the steps open in the agent's view.
   */
  const heard = (kept: Partial<typeof START>, events: readonly Event[], lines: unknown[] = []) => {
    const view: Record<string, string> = {};
    const wrong: string[] = [];
    const ids = JOURNEYS[0]?.steps.map((st) => st.id) ?? [];
    const machine = sessionMachine.provide({
      actors: {
        post: createCallbackLogic<Event, Post>(({ input, sendBack, self }) => {
          for (let post: Post | undefined = input; post !== undefined; post = post.next) {
            if (post.kind !== "settle" || post.step === undefined) continue;
            const line = postedLine(DEV, post, "now");
            lines.push(line);
            if (!("left" in line)) continue;
            const parts = "parts" in line ? line.parts : undefined;
            view[post.step] = keptKey(
              line.settled,
              Object.fromEntries(Object.entries(parts ?? {}).map(([p, v]) => [p, v.kept])),
              "variant" in line ? line.variant : undefined,
            );
            const open = ids.filter((id) => view[id] === "open").length;
            if (line.left !== open)
              wrong.push(
                `${post.step}: the line says ${String(line.left)} left, the agent knows ${String(open)}`,
              );
          }
          sendBack({ type: "posted", child: postId(self) });
        }),
      },
    });
    const actor = createActor(machine, {
      input: { kept: { ...START, journey: "prep", ...kept }, journeys: JOURNEYS, now: 0 },
    }).start();
    for (const id of ids) view[id] = keptNow(actor.getSnapshot().context.feedback[id]);
    events.forEach((event, i) => {
      actor.send(event);
      const { feedback, finish } = actor.getSnapshot().context;
      for (const id of ids) {
        const now = keptNow(feedback[id]);
        if (id !== finish?.step && view[id] !== now)
          wrong.push(
            `after ${events
              .slice(0, i + 1)
              .map((e) => e.type)
              .join(" > ")}: ${id} is ${now}, the agent heard ${view[id] ?? "nothing"}`,
          );
      }
    });
    actor.stop();
    return wrong;
  };
  const entered = { type: "entered" } as const;
  const settle = { type: "settle" } as const;
  const undo = { type: "undo" } as const;
  const redo = { type: "redo" } as const;

  it("hears that undo opened the settled steps again, as in Henrik's walk of 26 October", () => {
    // Steps a and b settled, then u twice, then a and b settled again: the agent read a's
    // second settle with b still settled, as no line said that undo opened them.
    expect(
      heard({ active: true }, [
        entered,
        settle,
        entered,
        settle,
        entered,
        undo,
        undo,
        entered,
        settle,
      ]),
    ).toEqual([]);
  });

  it("hears that redo settled a step again, and that undo opened a step it had settled", () => {
    expect(
      heard({ active: true }, [entered, settle, entered, undo, redo, entered, settle, undo]),
    ).toEqual([]);
  });

  it("hears a step that a message opened again", () => {
    expect(
      heard({ active: true }, [
        entered,
        settle,
        { type: "go", by: -1 },
        entered,
        { type: "write", id: stepNoteId("a"), step: "a", draft: "Not yet" },
        { type: "send", id: stepNoteId("a"), step: "a", at: 1 },
      ]),
    ).toEqual([]);
  });

  it("hears another pass over a settled journey, and the undo of it", () => {
    const done = { a: { settled: true }, b: { settled: true }, c: { settled: true } };
    expect(
      heard({ feedback: done }, [
        { type: "start", journey: "prep", at: 0, fresh: false, again: true },
        entered,
        undo,
        redo,
      ]),
    ).toEqual([]);
  });

  it("names the journey that starts again, not the page review it starts from", () => {
    const done = { a: { settled: true }, b: { settled: true }, c: { settled: true } };
    const journeys: string[] = [];
    const machine = sessionMachine.provide({
      actors: {
        post: createCallbackLogic<Event, Post>(({ input, sendBack, self }) => {
          for (let post: Post | undefined = input; post !== undefined; post = post.next)
            journeys.push(post.session.journey);
          sendBack({ type: "posted", child: postId(self) });
        }),
      },
    });
    const actor = createActor(machine, {
      input: {
        kept: { ...START, journey: "page", feedback: done },
        journeys: [
          ...JOURNEYS,
          { id: "page", steps: [{ id: "page:x", group: "/", variants: [] }] },
        ],
        now: 0,
      },
    }).start();
    expect(actor.getSnapshot().context.journey).toBe("page");
    actor.send({ type: "start", journey: "prep", at: 0, fresh: false, again: true });
    expect(journeys).toEqual(["prep", "prep", "prep"]);
  });

  const keep = (variant: string, step?: number): Event => ({
    type: "settle",
    keep: { part: "Requests", variant },
    ...(step === undefined ? {} : { step }),
  });

  it("hears a settled step keep another variant, and the undo and redo of it", () => {
    const lines: unknown[] = [];
    expect(
      heard(
        { active: true },
        [
          entered,
          keep("Dense list"),
          entered,
          { type: "go", by: -1 },
          entered,
          keep("Cards"),
          entered,
          undo,
          entered,
          redo,
        ],
        lines,
      ),
    ).toEqual([]);
    // The settle, the change, its undo and its redo: one line each.
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatchObject({
      step: { id: "a" },
      settled: true,
      left: 2,
      parts: { Requests: { kept: ["Cards"], dropped: [] } },
    });
    expect(lines[2]).toMatchObject({ parts: { Requests: { kept: ["Dense list"] } } });
  });

  it("hears a settled step that shows its kept variant opened again by its settle", () => {
    const lines: unknown[] = [];
    expect(
      heard(
        { active: true },
        [entered, keep("Dense list"), entered, { type: "go", by: -1 }, entered, keep("Dense list")],
        lines,
      ),
    ).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ step: { id: "a" }, settled: false });
  });

  it("hears a step opened again from the menu, and the undo of it", () => {
    expect(
      heard({ active: true }, [
        entered,
        keep("Dense list"),
        entered,
        { type: "reopen", step: 0 },
        undo,
        redo,
      ]),
    ).toEqual([]);
  });

  it("holds the finish through a change to another settled step: its line counts the last open", () => {
    const two = {
      a: { settled: true, parts: { Requests: { kept: ["Dense list"], dropped: [] } } },
      b: { settled: true },
    };
    const lines: unknown[] = [];
    expect(
      heard(
        { active: true, at: 2, feedback: two },
        [entered, settle, keep("Cards", 0), undo, redo, { type: "finish" }],
        lines,
      ),
    ).toEqual([]);
    // The change and its undo and redo say one step is left, the held one; only Finish says
    // none.
    expect(lines.map((l) => (l as { left: number }).left)).toEqual([1, 1, 1, 0]);
  });

  it("holds the finish when the held step keeps another variant, and Finish sends that one", () => {
    const two = { a: { settled: true }, b: { settled: true } };
    const lines: unknown[] = [];
    expect(
      heard(
        { active: true, at: 2, feedback: two },
        [entered, keep("Dense list"), keep("Cards"), { type: "finish" }],
        lines,
      ),
    ).toEqual([]);
    expect(lines).toEqual([
      expect.objectContaining({ left: 0, parts: { Requests: { kept: ["Cards"], dropped: [] } } }),
    ]);
  });

  it("goes back from the finish after the held step kept another variant", () => {
    const two = { a: { settled: true }, b: { settled: true } };
    expect(
      heard({ active: true, at: 2, feedback: two }, [
        entered,
        keep("Dense list"),
        keep("Cards"),
        { type: "back" },
        entered,
      ]),
    ).toEqual([]);
  });

  it("hears a step opened again while the finish waits, with the held settle", () => {
    const two = { a: { settled: true }, b: { settled: true } };
    expect(
      heard({ active: true, at: 2, feedback: two }, [
        entered,
        settle,
        { type: "reopen", step: 0 },
        undo,
      ]),
    ).toEqual([]);
  });

  it("hears nothing of the last settle until Finish, through undo, redo and Back", () => {
    const two = { a: { settled: true }, b: { settled: true } };
    expect(
      heard({ active: true, at: 2, feedback: two }, [
        entered,
        settle,
        undo,
        redo,
        { type: "back" },
        entered,
        settle,
        { type: "finish" },
        undo,
      ]),
    ).toEqual([]);
  });
});
