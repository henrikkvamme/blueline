import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { commandOf } from "../bin/lines";
import { entriesOf, reportOf, type Entry } from "../bin/log";
import { answer } from "../bin/reply";
import { claim, unclaim } from "../bin/wire";
import { logPath } from "../src/io/log";

/* The review's log: what each writer adds, and what `blueline log` makes of it. */

const MIN = 60_000;
const at = (minutes: number) => Date.parse("2026-10-30T10:00:00Z") + minutes * MIN;

describe("the log's report", () => {
  const entries: Entry[] = [
    { at: at(0), event: "sent", line: "L1", note: "fast", kind: "note" },
    { at: at(0.1), event: "claimed", line: "L1", note: "fast", by: "agent" },
    { at: at(0.2), event: "reply", note: "fast", state: "working" },
    { at: at(1), event: "reply", note: "fast", state: "replied", text: "Done" },
    { at: at(2), event: "sent", line: "L2", note: "stuck", kind: "note" },
    { at: at(2.1), event: "claimed", line: "L2", note: "stuck", by: "gone" },
    { at: at(5.1), event: "lapsed", line: "L2", note: "stuck", by: "gone" },
    { at: at(5.2), event: "claimed", line: "L2", note: "stuck", by: "next" },
    { at: at(9), event: "reply", note: "stuck", state: "replied" },
    { at: at(10), event: "sent", line: "L3", note: "left", kind: "note" },
    {
      at: at(11),
      event: "step",
      journey: "j",
      step: "b",
      total: 7_400,
      phases: [
        { name: "enter", ms: 400 },
        { name: "setup", ms: 6_900 },
      ],
    },
  ];

  it("tells each note's story, and flags the ones that went wrong", () => {
    const report = reportOf(entries, at(30));
    expect(report).toContain(
      "fast\n  sent 2026-10-30 10:00:00, taken by agent in 6 s, working in 12 s, replied in 1 min",
    );
    expect(report).toContain("stuck [slow first word, lapsed]");
    expect(report).toMatch(/stuck .*\n .*replied in 7 min, lapsed 1 time/);
    expect(report).toContain(
      "left [unanswered]\n  sent 2026-10-30 10:10:00, no reader took it, no reply after 20 min",
    );
    expect(report).toContain("j / b: 7.4 s (enter 400 ms, setup 6.9 s) [slow]");
  });

  it("gives one note's entries in order, from its first", () => {
    const report = reportOf(entries, at(30), "stuck");
    expect(report.split("\n")).toHaveLength(5);
    expect(report).toContain("+3 min lapsed line=L2 by=gone");
    expect(reportOf(entries, at(30), "none")).toBe("The log has nothing on none.");
  });

  it("reads the lines in time order, and skips one that does not read", () => {
    const text = `${JSON.stringify({ at: 2, event: "b" })}\nnot json\n${JSON.stringify({ at: 1, event: "a" })}\n`;
    expect(entriesOf(text).map((e) => e.event)).toEqual(["a", "b"]);
  });

  it("is a command", () => {
    expect(commandOf(["log", "f.jsonl"])).toEqual({
      kind: "log",
      file: "f.jsonl",
      note: undefined,
    });
    expect(commandOf(["log", "f.jsonl", "--note", "n"])).toEqual({
      kind: "log",
      file: "f.jsonl",
      note: "n",
    });
    expect(commandOf(["log", "f.jsonl", "--as", "x"])).toBeUndefined();
  });
});

describe("the agent's side of the log", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) =>
    Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

  it("logs each claim, give-back and reply", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-log-"));
    const feedback = path.join(dir, "feedback.jsonl");
    writeFileSync(feedback, `${JSON.stringify({ line: "A", id: "note-a", kind: "note" })}\n`);
    await run(claim(feedback, "agent", (fresh) => ({ take: fresh, through: "A" })));
    await run(unclaim(feedback, "agent", ["A"]));
    const reply = {
      kind: "reply",
      file: path.join(dir, "status.json"),
      id: "note-a",
      state: "replied",
      text: "Done",
      variant: undefined,
      blocks: undefined,
    } as const;
    await run(answer(reply, [{ kind: "callout", tone: "info", text: "Look" }]));
    const log = entriesOf(readFileSync(logPath(feedback), "utf8"));
    expect(log.map((e) => [e.event, e.line, e.note, e.by])).toEqual([
      ["claimed", "A", "note-a", "agent"],
      ["returned", "A", undefined, "agent"],
      ["reply", undefined, "note-a", undefined],
    ]);
    expect(log[2]).toMatchObject({ state: "replied", text: "Done", blocks: ["callout"] });
  });
});
