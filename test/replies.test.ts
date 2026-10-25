import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { blankNote, type Note } from "../src/notes/note";
import { sessionMachine } from "../src/session/machine";
import { nextNews } from "../src/session/replies";
import { START } from "../src/session/state";
import { openPlaceReply } from "../src/ui/replies";

const replied = (id: string, step: string, pin = false): Note => ({
  ...blankNote(id, step, pin ? { what: "x", selector: "x" } : undefined),
  thread: [{ by: "agent", text: "Done", at: 1 }],
  state: "replied",
  unread: true,
});

describe("the next reply", () => {
  const steps = ["a", "b", "c"];

  it("is on the first step with one after this step, round to the start", () => {
    const notes = [replied("1", "a"), replied("2", "c")];
    expect(nextNews(notes, steps, 0)?.at).toBe(2);
    expect(nextNews(notes, steps, 2)?.at).toBe(0);
  });

  it("is the step's own note before its pointed notes", () => {
    const notes = [replied("pin", "b", true), replied("step", "b")];
    expect(nextNews(notes, steps, 0)?.note.id).toBe("step");
  });

  it("comes back to this step last, and is none when nothing is new", () => {
    expect(nextNews([replied("1", "b")], steps, 1)?.at).toBe(1);
    expect(nextNews([blankNote("1", "a")], steps, 0)).toBeUndefined();
  });
});

describe("a reply on a page with no review", () => {
  const place = "place:/pursuits";
  const actor = () => {
    const a = createActor(sessionMachine, {
      input: { kept: { ...START, journey: "prep" }, journeys: [], now: 0 },
    }).start();
    a.send({ type: "place", place });
    return a;
  };

  it("opens the page's card", () => {
    const a = actor();
    openPlaceReply(a, replied("1", place));
    expect(a.getSnapshot().context.page).toBe(true);
    a.stop();
  });

  it("opens the page's card for a pinned note's reply, as the card's chat shows it", () => {
    const a = actor();
    openPlaceReply(a, replied("p1", place, true));
    expect(a.getSnapshot().context.page).toBe(true);
    expect(a.getSnapshot().matches({ layer: "pinned" })).toBe(false);
    a.stop();
  });

  it("does not open on another page", () => {
    const a = actor();
    openPlaceReply(a, replied("1", "place:/projects"));
    expect(a.getSnapshot().context.page).toBe(false);
    a.stop();
  });
});
