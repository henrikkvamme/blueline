import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BEFORE_TIMES, dated, replyAfter } from "../bin/lines";

/*
 * A reply that a Blueline before 0.1.8 wrote has no time. It came before the run that reads
 * it, so it gets the time before every chat, and the page never draws it as an answer to a
 * chat's new message (src/session/machine.ts, `replies`).
 */

const COMMAND = path.join(import.meta.dirname, "..", "bin", "blueline.ts");
const OLD = { state: "working", replies: [{ text: "Done: five designs" }] } as const;

describe("a reply from before times", () => {
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill();
  });

  it("gets the time before every chat, and a reply with a time keeps its own", () => {
    expect(dated(OLD)).toEqual({
      state: "working",
      replies: [{ text: "Done: five designs", at: BEFORE_TIMES }],
    });
    const timed = { state: "replied", replies: [{ text: "Yes", at: 5 }] } as const;
    expect(dated(timed)).toBe(timed);
    expect(dated({ state: "working" })).toEqual({ state: "working" });
  });

  it("gets it when the agent answers the note's new chat", () => {
    const command = {
      kind: "reply",
      file: "s",
      id: "n",
      state: "working",
      text: "",
      variant: undefined,
      blocks: undefined,
    } as const;
    expect(replyAfter(OLD, command, 9).replies).toEqual([
      { text: "Done: five designs", at: BEFORE_TIMES },
    ]);
  });

  it("gets it as the listener starts, before a note comes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "date-replies-"));
    const feedback = path.join(dir, "feedback.jsonl");
    const status = path.join(dir, "status.json");
    writeFileSync(feedback, "");
    writeFileSync(status, `${JSON.stringify({ "note-a": OLD, other: { kept: true } })}\n`);
    const listen = spawn(process.execPath, [COMMAND, "listen", feedback], { cwd: dir });
    children.push(listen);
    await vi.waitFor(
      () =>
        expect(JSON.parse(readFileSync(status, "utf8"))).toEqual({
          "note-a": { state: "working", replies: [{ text: "Done: five designs", at: 0 }] },
          other: { kept: true },
        }),
      { timeout: 10_000, interval: 100 },
    );
  });
});
