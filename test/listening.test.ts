import { describe, expect, it } from "vitest";
import { isListened, listenedJourneys, SILENT_MS } from "../src/io/listening";

describe("who listens to the reviewer's notes", () => {
  const now = 100_000;
  const listening = {
    "step-1": { journey: "preparation", at: now - 1_000 },
    gone: { journey: "submitted", at: now - SILENT_MS - 1 },
    all: { journey: null, at: now - SILENT_MS },
  };

  it("counts only the listeners heard from lately", () => {
    expect(listenedJourneys(listening, now)).toEqual(["preparation", null]);
  });

  it("says a journey is listened to by its listener, or by one for every journey", () => {
    expect(isListened(["preparation"], "preparation")).toBe(true);
    expect(isListened(["preparation"], "submitted")).toBe(false);
    expect(isListened([null], "submitted")).toBe(true);
    expect(isListened([], "preparation")).toBe(false);
  });

  it("cannot tell when the page cannot read who listens", () => {
    expect(isListened(undefined, "preparation")).toBeUndefined();
  });
});
