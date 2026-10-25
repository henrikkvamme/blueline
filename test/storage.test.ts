import { afterEach, describe, expect, it, vi } from "vitest";
import { loadKept } from "../src/io/storage";

const stored = (kept: unknown) => {
  const items = new Map([["kept", JSON.stringify(kept)]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => items.get(key) ?? null });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the review kept in the browser", () => {
  const pin = { what: "the field", selector: "#f" };
  const note = (id: string, more: object) => ({
    id,
    step: "a",
    pin,
    draft: "",
    state: "new",
    unread: false,
    thread: [],
    ...more,
  });

  it("keeps a pointed note not sent, and lets a sent one go, as its chat has it", () => {
    stored({
      notes: [
        note("waits", { draft: "Wider" }),
        note("sent", { thread: [{ by: "you", text: "Bold", at: 1 }], state: "replied" }),
        note("again", { thread: [{ by: "you", text: "Bold", at: 1 }], draft: "More" }),
      ],
    });
    const { notes } = loadKept("kept");
    expect(notes.map((n) => [n.id, n.draft, n.thread.length, n.state])).toEqual([
      ["waits", "Wider", 0, "new"],
      ["again", "More", 0, "new"],
    ]);
  });

  it("moves a sent pointed note's words and screenshots into the chat message that sent it", () => {
    const shot = { name: "a.png", file: "/a.png" };
    stored({
      notes: [
        note("note-a", {
          pin: undefined,
          thread: [
            { by: "you", text: "Look", at: 5 },
            { by: "agent", text: "Done", at: 6 },
            { by: "you", text: "", at: 9 },
          ],
          state: "replied",
        }),
        note("pinned", {
          thread: [
            { by: "you", text: "Bold", at: 5, images: [shot] },
            { by: "agent", text: "Bolder", at: 6 },
            { by: "you", text: "Wider", at: 9 },
          ],
          state: "waiting",
        }),
      ],
    });
    const { notes } = loadKept("kept");
    expect(notes.map((n) => n.id)).toEqual(["note-a"]);
    expect(notes[0]?.thread.map((m) => m.pins?.map((p) => [p.id, p.text, p.images]))).toEqual([
      [["pinned", "Bold", [shot]]],
      undefined,
      [["pinned", "Wider", undefined]],
    ]);
  });

  it("moves a legacy chat and its sent pointed note once, and keeps a draft written after the send", () => {
    stored({
      notes: [
        note("note-a", { pin: undefined, thread: [{ by: "you", text: "", at: 5 }] }),
        note("pinned", { thread: [{ by: "you", text: "Bold", at: 5 }], draft: "Next" }),
      ],
    });
    const first = loadKept("kept").notes;
    expect(first.map((n) => [n.id, n.draft, n.thread.length])).toEqual([
      ["note-a", "", 1],
      ["pinned", "Next", 0],
    ]);
    expect(first[0]?.thread[0]?.pins?.map((p) => p.text)).toEqual(["Bold"]);
    stored({ notes: first });
    expect(loadKept("kept").notes).toEqual(first);
  });

  it("starts on the step's chat when it kept none", () => {
    stored({ active: true });
    expect(loadKept("kept")).toMatchObject({ active: true, chat: "step" });
  });
});
