import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { claimedBy, cursorAtByte, freshFor, NO_CLAIMS } from "../bin/claims";
import { takeLines, type Line } from "../bin/lines";
import { listenerPick } from "../bin/listen";
import { reply } from "../bin/reply";
import { claim, feedbackLines } from "../bin/wire";
import { stamped } from "../src/vite";

const line = (fields: object) => `${JSON.stringify(fields)}\n`;
const linesOf = (text: string) => takeLines(new TextEncoder().encode(text)).lines;
const ids = (lines: readonly Line[]) => lines.map((l) => l.id);

describe("a line's identity", () => {
  it("is the ID the server stamps, with the format version", () => {
    expect(JSON.parse(stamped('{"kind":"note","id":"note-a"}', "L1") ?? "")).toEqual({
      kind: "note",
      id: "note-a",
      v: 1,
      line: "L1",
    });
    // The page cannot choose a line's ID.
    expect(JSON.parse(stamped('{"line":"mine"}', "L2") ?? "").line).toBe("L2");
    expect(stamped("[1]", "L3")).toBeUndefined();
    expect(stamped("not json", "L4")).toBeUndefined();
  });

  it("is its place in bytes for a line from before the stamp", () => {
    const text = line({ kind: "note", text: "Gjør" }) + line({ kind: "settle", line: "S" });
    expect(ids(linesOf(text))).toEqual(["@0", "S"]);
  });
});

describe("a claim", () => {
  const text =
    line({ line: "a", kind: "note", journey: "j" }) +
    line({ line: "b", kind: "settle", journey: "j", settled: true, left: 2 }) +
    line({ line: "c", kind: "note", journey: "k" }) +
    line({ line: "d", kind: "settle", journey: "j", settled: true, left: 1 });
  const lines = linesOf(text);

  it("gives a reader the lines after its cursor that no other reader took", () => {
    const claims = claimedBy(NO_CLAIMS, "other", lines.slice(2, 3), undefined, 1);
    expect(ids(freshFor(lines, claims, "me"))).toEqual(["a", "b", "d"]);
    const mine = claimedBy(claims, "me", lines.slice(0, 1), "a", 2);
    expect(ids(freshFor(lines, mine, "me"))).toEqual(["b", "d"]);
    // A cursor the file no longer has: the file was started again.
    expect(ids(freshFor(lines, { ...mine, cursors: { me: "gone" } }, "me"))).toEqual([
      "a",
      "b",
      "d",
    ]);
  });

  it("starts a listener from before the claims at its read mark", () => {
    const second = new TextEncoder().encode(line({ line: "a", kind: "note" })).length;
    expect(cursorAtByte(lines, second)).toBe("a");
    expect(cursorAtByte(lines, 0)).toBeUndefined();
  });

  it("takes a listener's journey up to the last note, and leaves the settles after it", () => {
    expect(listenerPick(lines, "j")).toEqual({
      take: [lines[0]],
      through: "a",
      held: 2,
    });
    // Every journey: the note on k needs the agent, and the settle before it comes with it.
    expect(ids(listenerPick(lines, undefined).take)).toEqual(["a", "b", "c"]);
    expect(listenerPick(lines.slice(1, 2), "j")).toEqual({ take: [], through: undefined, held: 1 });
  });
});

describe("the files at once", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) =>
    Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

  it("gives each line to one reader, with many readers at once", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const feedback = path.join(dir, ".blueline", "feedback.jsonl");
    const readers = ["a", "b", "c", "d", "e", "f"];
    const takeAll = (reader: string) =>
      claim(feedback, reader, (fresh) => ({ take: fresh, through: fresh.at(-1)?.id }));
    // The folder does not exist yet: the lock makes it.
    await run(takeAll("a"));
    writeFileSync(
      feedback,
      Array.from({ length: 40 }, (_, i) => line({ line: `L${String(i)}`, kind: "note" })).join(""),
    );
    const taken = await run(Effect.forEach(readers, takeAll, { concurrency: "unbounded" }));
    const all = taken.flatMap(ids);
    expect([...all].sort()).toEqual(ids(await run(feedbackLines(feedback))).sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps every reply, with many replies at once", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const status = path.join(dir, "status.json");
    const notes = Array.from({ length: 12 }, (_, i) => `note-${String(i)}`);
    await run(
      Effect.forEach(
        notes,
        (id) =>
          reply({
            kind: "reply",
            file: status,
            id,
            state: "replied",
            text: `Done ${id}`,
            variant: undefined,
            blocks: undefined,
          }),
        { concurrency: "unbounded" },
      ),
    );
    const written: Record<string, unknown> = JSON.parse(readFileSync(status, "utf8"));
    expect(Object.keys(written).sort()).toEqual([...notes].sort());
  });
});
