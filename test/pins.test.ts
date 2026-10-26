import { describe, expect, it } from "vitest";
import { initialTransition, transition, type SnapshotFrom } from "xstate";
import { joinsDraft } from "../src/notes/pins";
import { sessionMachine, stepNoteId, type Event } from "../src/session/machine";
import { START } from "../src/session/state";

type Snapshot = SnapshotFrom<typeof sessionMachine>;

const place = "place:/requests";
const pin = { what: "the “Amount” cell", selector: "#amount" };

const page = (): Snapshot =>
  initialTransition(sessionMachine, {
    kept: START,
    journeys: [],
    now: 0,
    place,
  })[0];

const after = (snapshot: Snapshot, ...events: readonly Event[]) =>
  events.reduce((s, e) => transition(sessionMachine, s, e)[0], snapshot);

/** Enter in the note card: it sends the note at once, unless it joins the field's words. */
const enter = (s: Snapshot): Snapshot =>
  joinsDraft(s.context.notes, place)
    ? after(s, { type: "close" })
    : after(
        s,
        { type: "close" },
        { type: "send", id: stepNoteId(place), step: place, at: 2, text: "" },
      );

/** Cmd+Enter in the note card, or Later: the note waits on its pin, and nothing goes. */
const later = (s: Snapshot): Snapshot => after(s, { type: "close" });

describe("a pointed note", () => {
  it("waits on its pin with Later, and goes with the next message", () => {
    const kept = later(
      after(
        page(),
        { type: "point", id: "p1", pin },
        { type: "write", id: "p1", step: place, pin, draft: "Bad" },
      ),
    );
    expect(kept.context.notes.find((n) => n.id === "p1")?.draft).toBe("Bad");
    expect(kept.context.notes.find((n) => n.id === stepNoteId(place))).toBeUndefined();
    expect(kept.context.posts).toBe(0);
    const sent = after(
      kept,
      { type: "write", id: stepNoteId(place), step: place, draft: "And this" },
      { type: "send", id: stepNoteId(place), step: place, at: 3 },
    );
    expect(sent.context.notes.find((n) => n.id === stepNoteId(place))?.thread).toEqual([
      expect.objectContaining({
        text: "And this",
        pins: [expect.objectContaining({ text: "Bad" })],
      }),
    ]);
    expect(sent.context.notes.some((n) => n.id === "p1")).toBe(false);
  });

  it("goes to the agent at once, as a message with its pin, when the chat's field is empty", () => {
    const s = enter(
      after(
        page(),
        { type: "point", id: "p1", pin },
        { type: "write", id: "p1", step: place, pin, draft: "Bad" },
      ),
    );
    const chat = s.context.notes.find((n) => n.id === stepNoteId(place));
    expect(chat?.thread).toEqual([
      expect.objectContaining({
        by: "you",
        text: "",
        pins: [expect.objectContaining({ text: "Bad" })],
      }),
    ]);
    expect(chat?.state).toBe("waiting");
    // It waits no more: the message has it.
    expect(s.context.notes.some((n) => n.id === "p1")).toBe(false);
  });

  it("joins the words in the chat's field, and goes with that message", () => {
    const written = after(
      page(),
      { type: "write", id: stepNoteId(place), step: place, draft: "Two things" },
      { type: "point", id: "p1", pin },
      { type: "write", id: "p1", step: place, pin, draft: "Bad" },
    );
    expect(joinsDraft(written.context.notes, place)).toBe(true);
    const kept = enter(written);
    expect(kept.context.notes.find((n) => n.id === "p1")?.draft).toBe("Bad");
    expect(kept.context.notes.find((n) => n.id === stepNoteId(place))?.thread).toEqual([]);
    const sent = after(kept, { type: "send", id: stepNoteId(place), step: place, at: 3 });
    expect(sent.context.notes.find((n) => n.id === stepNoteId(place))?.thread).toEqual([
      expect.objectContaining({
        text: "Two things",
        pins: [expect.objectContaining({ text: "Bad" })],
      }),
    ]);
  });
});
