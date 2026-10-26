import { describe, expect, it } from "vitest";
import { initialTransition, transition, type SnapshotFrom } from "xstate";
import { handoffId, handoffStatus, newHandoff } from "../src/notes/handoff";
import { blankNote, noteAfter, sentCount } from "../src/notes/note";
import {
  canTakeBack,
  followUpOf,
  isFollowUp,
  takeBackWords,
  takenBack,
} from "../src/notes/take-back";
import { postedLine } from "../src/session/lines";
import { sessionMachine, stepNoteId, type Event, type Post } from "../src/session/machine";
import { START, type Shape } from "../src/session/state";
import type { DevJourney } from "../src/types";

const JOURNEYS: readonly Shape[] = [
  {
    id: "prep",
    title: "Handle a request",
    steps: [
      { id: "a", group: "P1", variants: [] },
      { id: "b", group: "P1", variants: ["One", "Two"] },
    ],
  },
];

const DEV: readonly DevJourney<unknown>[] = [
  {
    id: "prep",
    title: "Handle a request",
    steps: [
      { id: "a", title: "Open the form", look: "", group: { id: "P1", title: "Prepare" } },
      {
        id: "b",
        title: "Pick a layout",
        look: "",
        group: { id: "P1", title: "Prepare" },
        variants: [{ label: "One" }, { label: "Two" }],
      },
    ],
  },
];

type Snapshot = SnapshotFrom<typeof sessionMachine>;

const start = (kept: Partial<typeof START> = {}): Snapshot =>
  initialTransition(sessionMachine, {
    kept: { ...START, journey: "prep", active: true, ...kept },
    journeys: JOURNEYS,
    now: 0,
  })[0];

const after = (snapshot: Snapshot, ...events: readonly Event[]) =>
  events.reduce((s, e) => transition(sessionMachine, s, e)[0], snapshot);

/** The posts that the event starts, in their order. */
const postsOf = (snapshot: Snapshot, event: Event): Post[] =>
  transition(sessionMachine, snapshot, event)[1].flatMap((a) => {
    if (a.type !== "xstate.spawnChild") return [];
    const input: unknown = "input" in a.params ? a.params.input : undefined;
    return isPost(input) ? [input] : [];
  });

const isPost = (value: unknown): value is Post =>
  typeof value === "object" && value !== null && "kind" in value && "session" in value;

/** 14:32 today, on the machine's clock, as the reviewer's own clock reads it. */
const AT = new Date(2026, 9, 26, 14, 32).getTime();
const chat = stepNoteId("a");

const sent = () =>
  after(
    start(),
    { type: "entered" },
    { type: "write", id: chat, step: "a", draft: "Make the button blue and put it at the right" },
    { type: "send", id: chat, step: "a", at: AT },
  );

const thread = (s: Snapshot, id = chat) => s.context.notes.find((n) => n.id === id)?.thread ?? [];

describe("the words of a take-back", () => {
  it("quotes the message's first words and its time, and tells the agent what to do", () => {
    expect(takeBackWords({ text: "Make the button blue", pins: [], at: AT })).toBe(
      'Take back my message of 14:32 ("Make the button blue"). Ignore it. If you started work ' +
        "on it, stop. Do not undo the changes you made, unless I ask. Wait for my next " +
        "message. Reply to confirm.",
    );
  });

  it("cuts a long message to about 60 characters, on one line", () => {
    const words = takeBackWords({
      text: "Make the button blue\nand move it to the right of the field, under the heading",
      pins: [],
      at: AT,
    });
    expect(words).toContain('("Make the button blue and move it to the right of the field,…")');
  });

  it("quotes the first annotation of a message with no words, or nothing", () => {
    const pin = { id: "p1", pin: { what: "the field", selector: "#f" }, text: "Too tight" };
    expect(takeBackWords({ text: "", pins: [pin], at: AT })).toMatch(
      /^Take back my message of 14:32 \("Too tight"\)\. Ignore it\./,
    );
    expect(takeBackWords({ text: "", pins: [], at: AT })).toMatch(
      /^Take back my message of 14:32\. Ignore it\./,
    );
  });

  it("names the journey of a finished review", () => {
    expect(takeBackWords({ journey: "Handle a request" })).toBe(
      'Take back my finished review of "Handle a request". Ignore it and its verdicts. If you ' +
        "started work on it, stop. Do not undo the changes you made, unless I ask. Wait for my " +
        "next message. Reply to confirm.",
    );
  });
});

describe("taking back a sent message", () => {
  it("adds one follow-up to the chat that names the message, and writes it as a note line", () => {
    const s = sent();
    const event: Event = { type: "takeBack", id: chat, message: AT, at: AT + 60_000 };
    const [post] = postsOf(s, event);
    const back = after(s, event);
    const [message, followUp] = thread(back);
    expect(followUp).toMatchObject({ by: "you", withdraws: { id: chat, at: AT } });
    expect(followUp?.text).toBe(takeBackWords({ text: message?.text ?? "", pins: [], at: AT }));
    expect(takenBack(thread(back), AT)).toBe(true);
    expect(back.context.notes.find((n) => n.id === chat)?.state).toBe("waiting");
    expect(post?.kind).toBe("note");
    const line = postedLine(DEV, post ?? { kind: "note", ids: [], session: s.context }, "now");
    expect(line).toMatchObject({
      kind: "note",
      journey: "prep",
      id: chat,
      sentWords: true,
      pins: [],
      withdraws: { id: chat, at: AT },
    });
    expect("thread" in line && line.thread.at(-1)?.text).toBe(followUp?.text);
  });

  it("takes a message back once, and never a follow-up", () => {
    const s = sent();
    const back = after(s, { type: "takeBack", id: chat, message: AT, at: AT + 1 });
    expect(canTakeBack(thread(back), AT)).toBe(false);
    expect(postsOf(back, { type: "takeBack", id: chat, message: AT, at: AT + 2 })).toEqual([]);
    expect(after(back, { type: "takeBack", id: chat, message: AT, at: AT + 2 }).context).toEqual(
      back.context,
    );
    // The follow-up has no take-back of its own.
    expect(canTakeBack(thread(back), AT + 1)).toBe(false);
    expect(postsOf(back, { type: "takeBack", id: chat, message: AT + 1, at: AT + 3 })).toEqual([]);
  });

  it("takes back nothing that is not the reviewer's message", () => {
    const s = sent();
    expect(postsOf(s, { type: "takeBack", id: chat, message: 1, at: AT + 1 })).toEqual([]);
    expect(postsOf(s, { type: "takeBack", id: "note-z", message: AT, at: AT + 1 })).toEqual([]);
    // A step's chat is no finish.
    expect(postsOf(s, { type: "takeBack", id: chat, at: AT + 1 })).toEqual([]);
  });

  it("takes back an annotation sent from its card, in the step's chat", () => {
    const pin = { what: "the field", selector: "#f" };
    const s = after(
      start(),
      { type: "entered" },
      { type: "point", id: "p1", pin },
      { type: "write", id: "p1", step: "a", pin, draft: "Too tight" },
      { type: "close" },
      { type: "send", id: chat, step: "a", at: AT, text: "" },
    );
    const back = after(s, { type: "takeBack", id: chat, message: AT, at: AT + 1 });
    expect(thread(back).at(-1)?.text).toMatch(/^Take back my message of 14:32 \("Too tight"\)/);
  });

  it("leaves the step's settle as it is, and is no change that u takes back", () => {
    const s = after(sent(), { type: "settle" });
    expect(s.context.feedback["a"]?.settled).toBe(true);
    const back = after(s, { type: "takeBack", id: chat, message: AT, at: AT + 1 });
    expect(back.context.feedback["a"]?.settled).toBe(true);
    expect(back.context.past).toEqual(s.context.past);
  });

  it("does not take back a send with u: sending is not undoable", () => {
    const s = sent();
    expect(after(s, { type: "undo" }).context.notes).toEqual(s.context.notes);
  });

  it("drops a follow-up the dev server did not take, and keeps the draft", () => {
    const s = after(sent(), { type: "takeBack", id: chat, message: AT, at: AT + 1 });
    const failed = after(s, { type: "failed", ids: [chat] });
    expect(thread(failed).map((m) => m.text)).toEqual([
      "Make the button blue and put it at the right",
    ]);
    expect(failed.context.notes.find((n) => n.id === chat)?.draft).toBe("");
    expect(canTakeBack(thread(failed), AT)).toBe(true);
  });

  it("does not count a follow-up as sent", () => {
    const back = after(sent(), { type: "takeBack", id: chat, message: AT, at: AT + 1 });
    expect(sentCount(back.context.notes, new Set(["a"]))).toBe(1);
  });
});

describe("taking back a finished review", () => {
  const finished = () =>
    after(
      start({ at: 1, feedback: { a: { settled: true } } }),
      { type: "entered" },
      { type: "settle" },
      { type: "finish", at: 5 },
    );
  const id = handoffId("prep", 5);

  it("writes one follow-up on the hand-off that names the finish, and keeps the journey settled", () => {
    const s = finished();
    const event: Event = { type: "takeBack", id, at: 9 };
    const [post] = postsOf(s, event);
    const back = after(s, event);
    expect(thread(back, id)).toEqual([
      {
        by: "you",
        text: takeBackWords({ journey: "Handle a request" }),
        at: 9,
        withdraws: { id },
      },
    ]);
    expect(takenBack(thread(back, id), undefined)).toBe(true);
    expect(back.context.feedback).toEqual(s.context.feedback);
    const line = postedLine(DEV, post ?? { kind: "note", ids: [], session: s.context }, "now");
    expect(line).toMatchObject({ kind: "note", journey: "prep", id, withdraws: { id } });
    expect(line).not.toHaveProperty("step");
  });

  it("takes a finish back once", () => {
    const back = after(finished(), { type: "takeBack", id, at: 9 });
    expect(canTakeBack(thread(back, id), undefined)).toBe(false);
    expect(postsOf(back, { type: "takeBack", id, at: 10 })).toEqual([]);
  });
});

describe("a follow-up in a chat", () => {
  it("is told from the reviewer's own messages", () => {
    const n = noteAfter(blankNote(chat, "a"), { type: "send", at: 1, text: "Bold" });
    const back = noteAfter(n, {
      type: "send",
      at: 2,
      text: "Take back",
      withdraws: { id: chat, at: 1 },
    });
    expect(back.thread.map(isFollowUp)).toEqual([false, true]);
    expect(followUpOf(back.thread, 1)).toBe(back.thread[1]);
    expect(followUpOf(back.thread, 2)).toBeUndefined();
  });
});

describe("a finished review's row in the tree", () => {
  const id = handoffId("prep", 5);
  const handoff = () => newHandoff("prep", 5);
  const plan = (items: readonly { text: string; state: "done" | "doing" | "todo" }[]) => [
    { kind: "plan" as const, items },
  ];

  it("says Sent until the agent takes the review", () => {
    expect(handoffStatus(handoff())).toEqual({ kind: "sent" });
  });

  it("says Working, with the plan's current item", () => {
    const working = noteAfter(handoff(), {
      type: "working",
      progress: plan([
        { text: "Read the review", state: "done" },
        { text: "Apply the kept variants", state: "doing" },
        { text: "Run the tests", state: "todo" },
      ]),
    });
    expect(handoffStatus(working)).toEqual({ kind: "working", doing: "Apply the kept variants" });
    expect(handoffStatus(noteAfter(handoff(), { type: "working" }))).toEqual({ kind: "working" });
  });

  it("says Replied, with the reply's first line", () => {
    const replied = noteAfter(handoff(), {
      type: "reply",
      at: 6,
      replies: [{ text: "Applied both parts.\nThe tests pass." }],
      settled: false,
    });
    expect(handoffStatus(replied)).toEqual({ kind: "replied", reply: "Applied both parts." });
  });

  it("says Taken back once the finish is taken back, also after the agent confirms", () => {
    const back = noteAfter(handoff(), {
      type: "send",
      at: 9,
      text: "Take back",
      withdraws: { id },
    });
    expect(handoffStatus(back)).toEqual({ kind: "taken" });
    const confirmed = noteAfter(back, {
      type: "reply",
      at: 10,
      replies: [{ text: "Ignored, and waiting." }],
      settled: false,
    });
    expect(handoffStatus(confirmed)).toEqual({ kind: "taken" });
  });
});
