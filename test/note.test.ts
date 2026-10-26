import { describe, expect, it } from "vitest";
import {
  blankNote,
  isKept,
  noteAfter,
  sentCount,
  type Note,
  type NoteEvent,
} from "../src/notes/note";

const PLAN = [
  {
    kind: "plan",
    items: [
      { text: "Read the note", state: "done" },
      { text: "Make it bold", state: "doing" },
    ],
  },
] as const;

const EVENTS: readonly NoteEvent[] = [
  { type: "write", draft: "Make it bold" },
  { type: "write", draft: "" },
  { type: "send", at: 1 },
  { type: "send", at: 2, text: "Another variant" },
  { type: "failed" },
  { type: "working" },
  { type: "working", progress: PLAN },
  { type: "reply", at: 3, replies: [{ text: "Done", variant: "B" }], settled: false },
  { type: "reply", at: 4, replies: [], settled: true },
  { type: "reply", at: 5, replies: [{ text: "Settled, as you said" }], settled: true },
  { type: "settle" },
  { type: "reopen" },
  { type: "read" },
];

/** Every note reachable from a blank one in up to `depth` events, with the path there. */
function reachable(depth: number) {
  const seen = new Map<string, { note: Note; path: readonly NoteEvent[] }>();
  let frontier = [{ note: blankNote("n", "s"), path: [] as readonly NoteEvent[] }];
  for (let d = 0; d <= depth; d += 1) {
    const next: typeof frontier = [];
    for (const item of frontier) {
      const key = JSON.stringify(item.note);
      if (seen.has(key)) continue;
      seen.set(key, item);
      for (const event of EVENTS)
        next.push({ note: noteAfter(item.note, event), path: [...item.path, event] });
    }
    frontier = next;
  }
  return [...seen.values()];
}

const notes = reachable(6);

describe("a note's lifecycle, over every path of up to six events", () => {
  it("reaches every state", () => {
    expect(new Set(notes.map((n) => n.note.state))).toEqual(
      new Set(["new", "waiting", "working", "replied", "settled"]),
    );
  });

  it("is replied or settled by the agent only when the agent said something", () => {
    for (const { note, path } of notes) {
      const agent = note.thread.some((m) => m.by === "agent");
      if (note.state === "replied" || note.settledBy === "agent")
        expect(agent, JSON.stringify(path)).toBe(true);
    }
  });

  it("waits for the agent only after the reviewer said something", () => {
    for (const { note, path } of notes)
      if (note.state === "waiting" || note.state === "working")
        expect(note.thread.at(-1)?.by, JSON.stringify(path)).toBe("you");
  });

  it("says who settled it exactly when it is settled", () => {
    for (const { note, path } of notes)
      expect(note.settledBy !== undefined, JSON.stringify(path)).toBe(note.state === "settled");
  });

  it("shows the agent's progress only while the agent works", () => {
    for (const { note, path } of notes)
      if (note.progress !== undefined) expect(note.state, JSON.stringify(path)).toBe("working");
  });

  it("is unread only with an agent reply last or settled", () => {
    for (const { note, path } of notes)
      if (note.unread)
        expect(
          note.thread.some((m) => m.by === "agent"),
          JSON.stringify(path),
        ).toBe(true);
  });
});

describe("a note", () => {
  const written = noteAfter(blankNote("n", "s"), { type: "write", draft: " Bold " });

  it("sends its draft and empties it", () => {
    const sent = noteAfter(written, { type: "send", at: 1, variant: "A" });
    expect(sent.state).toBe("waiting");
    expect(sent.draft).toBe("");
    expect(sent.thread).toEqual([{ by: "you", text: "Bold", at: 1, variant: "A" }]);
  });

  it("sends a quick text and keeps the draft", () => {
    const sent = noteAfter(written, { type: "send", at: 1, text: "Another variant" });
    expect(sent.draft).toBe(" Bold ");
    expect(sent.thread.at(-1)?.text).toBe("Another variant");
  });

  it("does not send nothing", () => {
    expect(noteAfter(blankNote("n", "s"), { type: "send", at: 1 }).state).toBe("new");
  });

  it("takes the words back when the dev server fails", () => {
    const sent = noteAfter(written, { type: "send", at: 1 });
    const back = noteAfter(sent, { type: "failed" });
    expect(back.state).toBe("new");
    expect(back.draft).toBe("Bold");
    expect(back.thread).toEqual([]);
  });

  it("is not settled by the agent before it replied", () => {
    const sent = noteAfter(written, { type: "send", at: 1 });
    expect(noteAfter(sent, { type: "reply", at: 2, replies: [], settled: true }).state).toBe(
      "waiting",
    );
  });

  it("shows the newest progress in place, and ends it with the reply", () => {
    const sent = noteAfter(written, { type: "send", at: 1 });
    const working = noteAfter(sent, { type: "working", progress: PLAN });
    expect([working.state, working.progress]).toEqual(["working", PLAN]);
    const done = [{ kind: "plan", items: [{ text: "Make it bold", state: "done" }] }] as const;
    const on = noteAfter(working, { type: "working", progress: done });
    expect(on.progress).toEqual(done);
    expect(on.thread).toEqual(working.thread);
    const replied = noteAfter(on, {
      type: "reply",
      at: 2,
      replies: [{ text: "Bold" }],
      settled: false,
    });
    expect([replied.state, replied.progress]).toEqual(["replied", undefined]);
  });

  it("is settled by the reviewer after a reply, and reopens", () => {
    const sent = noteAfter(written, { type: "send", at: 1 });
    const replied = noteAfter(sent, {
      type: "reply",
      at: 2,
      replies: [{ text: "B" }],
      settled: false,
    });
    expect(replied.unread).toBe(true);
    const settled = noteAfter(replied, { type: "settle" });
    expect([settled.state, settled.settledBy, settled.unread]).toEqual(["settled", "you", false]);
    expect(noteAfter(settled, { type: "reopen" }).state).toBe("replied");
  });
});

describe("a screenshot", () => {
  const shot = { name: "a.png", file: "/tmp/a.png" };

  it("is kept with the draft, goes with the message, and comes back if the send fails", () => {
    const kept = noteAfter(blankNote("n", "s"), { type: "write", draft: "", images: [shot] });
    expect(isKept(kept)).toBe(true);
    const sent = noteAfter(kept, { type: "send", at: 1 });
    expect(sent.state).toBe("waiting");
    expect(sent.thread.at(-1)?.images).toEqual([shot]);
    expect(sent.images).toBeUndefined();
    const failed = noteAfter(sent, { type: "failed" });
    expect(failed.images).toEqual([shot]);
    expect(failed.thread).toEqual([]);
  });

  it("stays with the draft when the words are written again", () => {
    const kept = noteAfter(blankNote("n", "s"), { type: "write", draft: "", images: [shot] });
    expect(noteAfter(kept, { type: "write", draft: "Look" }).images).toEqual([shot]);
  });
});

describe("a pointed note", () => {
  it("goes in its chat's message, and the message counts with no words of its own", () => {
    const pins = [{ id: "p", pin: { what: "the field", selector: "#f" }, text: "Bold" }];
    const sent = noteAfter(blankNote("note-s", "s"), { type: "send", at: 10, text: "", pins });
    expect(sent.state).toBe("waiting");
    expect(sent.thread).toEqual([{ by: "you", text: "", at: 10, pins }]);
  });
});

describe("what the finish counts as sent", () => {
  const sent = (text: string, pins: number, by: "you" | "agent" = "you") => ({
    by,
    at: 1,
    text,
    pins: Array.from({ length: pins }, (_, i) => ({
      id: `p${String(i)}`,
      pin: { what: "a field", selector: "#f" },
      text: "Bolder",
    })),
  });
  const chat = (step: string, thread: Note["thread"]): Note => ({
    ...blankNote(`note-${step}`, step),
    thread,
  });

  it("counts each message with words and each annotation, on the steps given", () => {
    const notes = [
      chat("a", [sent("Shorter", 2), sent("", 1), sent("Done", 0, "agent")]),
      chat("b", [sent("Not counted", 3)]),
    ];
    // "Shorter" and its two annotations, and the annotation sent with no words.
    expect(sentCount(notes, new Set(["a"]))).toBe(4);
  });
});
