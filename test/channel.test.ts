import { describe, expect, it } from "vitest";
import { ageOf, cameLate, commandOf, helpOf, replyAfter, takeLines, wakes } from "../bin/lines";
import { tagged } from "../bin/listen";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("the agent's side of the channel", () => {
  it("reads whole lines, and leaves a line the server still writes for the next read", () => {
    const one = '{"journey":"preparation","sentAt":"2026-10-20T19:13:10.380Z","id":"a"}\n';
    const { lines, used } = takeLines(bytes(`${one}not json\n{"journey":"pre`));
    expect(lines).toEqual([
      {
        raw: one.trim(),
        id: expect.stringMatching(/^@0:[0-9a-z]+$/),
        start: 0,
        journey: "preparation",
        sentAt: "2026-10-20T19:13:10.380Z",
        answers: "a",
      },
    ]);
    expect(used).toBe(bytes(`${one}not json\n`).length);
  });

  it("counts bytes, so a mark stays right after words with letters such as ø", () => {
    const line = '{"text":"Gjør det"}\n';
    expect(takeLines(bytes(line)).used).toBe(bytes(line).length);
  });

  it("says where each line starts, in bytes, so a mark can stay at a line", () => {
    const one = '{"text":"Gjør"}\n';
    const { lines } = takeLines(bytes(`${one}{"kind":"settle"}\n`));
    expect(lines.map((l) => l.start)).toEqual([0, bytes(one).length]);
  });

  it("wakes the agent for a note and the review's end, and not for a settle", () => {
    const line = (fields: object) => takeLines(bytes(`${JSON.stringify(fields)}\n`)).lines[0];
    const wake = (fields: object) => {
      const l = line(fields);
      return l !== undefined && wakes(l);
    };
    expect(wake({ kind: "note" })).toBe(true);
    expect(wake({ kind: "settle", settled: true, left: 2 })).toBe(false);
    expect(wake({ kind: "settle", settled: false, left: 0 })).toBe(false);
    expect(wake({ kind: "settle", settled: true, left: 0 })).toBe(true);
  });

  it("prints a command's help for --help anywhere, and takes no flag as a word", () => {
    expect(helpOf(["request", "--help"])).toBe(
      "Usage:\n  blueline request <title> [--body <text>]",
    );
    expect(helpOf(["request", "Pins drift", "-h"])).toContain("blueline request <title>");
    expect(helpOf(["--help"])).toContain("blueline apply");
    expect(helpOf(["help"])).toContain("blueline apply");
    expect(helpOf(["request", "help"])).toBeUndefined();
    expect(helpOf(["dev", "--", "vite", "--help"])).toBeUndefined();
    expect(helpOf(["request", "Pins drift"])).toBeUndefined();
    expect(commandOf(["request", "--help"])).toBeUndefined();
    expect(commandOf(["request", "Pins", "--body"])).toBeUndefined();
  });

  it("wakes the agent for a settle with verdicts, to apply them at once", () => {
    const settle = { kind: "settle", settled: true, left: 2, apply: "Run now" };
    const { lines } = takeLines(bytes(`${JSON.stringify(settle)}\n`));
    expect(lines.map(wakes)).toEqual([true]);
    expect(tagged(lines, 0, false)[0]).toMatch(/^\[new, sent .*, apply its verdicts now\] /);
  });

  it("wakes the agent for a take-back, as for any note, after the settles it held", () => {
    const followUp = {
      kind: "note",
      journey: "prep",
      sentAt: "2026-10-26T13:33:00.000Z",
      id: "note-a",
      thread: [
        { by: "you", text: "Bold", at: 1 },
        {
          by: "you",
          text: "Take back my message of 14:32",
          at: 2,
          withdraws: { id: "note-a", at: 1 },
        },
      ],
      withdraws: { id: "note-a", at: 1 },
    };
    const finish = {
      kind: "note",
      journey: "prep",
      id: "finish-prep-5",
      thread: [{ by: "you", text: "Take back", at: 9, withdraws: { id: "finish-prep-5" } }],
      withdraws: { id: "finish-prep-5" },
    };
    const text = [{ kind: "settle", settled: true, left: 1 }, followUp, finish]
      .map((l) => `${JSON.stringify(l)}\n`)
      .join("");
    const { lines } = takeLines(bytes(text));
    expect(lines.map(wakes)).toEqual([false, true, true]);
    expect(lines[1]?.raw).toBe(JSON.stringify(followUp));
  });

  it("says how long ago a note was sent", () => {
    const now = Date.parse("2026-10-21T08:00:00Z");
    expect(ageOf("2026-10-21T07:59:40Z", now)).toBe("just now");
    expect(ageOf("2026-10-21T07:48:00Z", now)).toBe("12 min ago");
    expect(ageOf("2026-10-20T19:13:10Z", now)).toBe("13 h ago");
    expect(ageOf(undefined, now)).toBe("at an unknown time");
    expect(cameLate("2026-10-21T07:48:00Z", now, 5 * 60_000)).toBe(true);
    expect(cameLate("2026-10-21T07:58:00Z", now, 5 * 60_000)).toBe(false);
  });

  it("reads the commands, and no half command", () => {
    expect(commandOf(["listen", "f.jsonl", "--journey", "preparation"])).toEqual({
      kind: "listen",
      file: "f.jsonl",
      journey: "preparation",
      name: "preparation",
    });
    expect(commandOf(["reply", "s.json", "n1", "replied", "Done", "--variant", "B"])).toMatchObject(
      {
        state: "replied",
        text: "Done",
        variant: "B",
      },
    );
    expect(commandOf(["reply", "s.json", "n1", "replied"])).toBeUndefined();
    expect(commandOf(["listen"])).toBeUndefined();
    expect(commandOf(["dev", "--", "pnpm", "dev", "--port", "4000"])).toEqual({
      kind: "dev",
      command: ["pnpm", "dev", "--port", "4000"],
      port: undefined,
      host: undefined,
    });
    expect(commandOf(["dev", "--port", "4000", "--host", "0.0.0.0", "--", "node", "s.js"])).toEqual(
      {
        kind: "dev",
        command: ["node", "s.js"],
        port: 4000,
        host: "0.0.0.0",
      },
    );
    expect(commandOf(["dev", "pnpm", "dev"])).toBeUndefined();
    expect(commandOf(["dev", "--"])).toBeUndefined();
    expect(commandOf(["dev", "--port", "x", "--", "node"])).toBeUndefined();
    expect(commandOf(["apply", "f.jsonl", "--part", "Suggestion"])).toEqual({
      kind: "apply",
      file: "f.jsonl",
      part: "Suggestion",
      keep: undefined,
      src: ".",
    });
    expect(commandOf(["apply", "f.jsonl"])).toBeUndefined();
    expect(commandOf(["review", "f.jsonl", "--url", "http://localhost:4380/"])).toEqual({
      kind: "review",
      file: "f.jsonl",
      url: "http://localhost:4380/",
      journey: "page",
      step: undefined,
      name: "page",
    });
    expect(commandOf(["review", "f.jsonl"])).toBeUndefined();
  });

  it("adds a reply to the ones before, and settles without losing them", () => {
    const reply = (state: "working" | "replied" | "settled", text = "") =>
      ({
        kind: "reply",
        file: "s",
        id: "n",
        state,
        text,
        variant: undefined,
        blocks: undefined,
      }) as const;
    const working = replyAfter(undefined, reply("working"), 1);
    const first = replyAfter(working, reply("replied", "One"), 2);
    const second = replyAfter(first, reply("replied", "Two"), 3);
    // Each reply keeps when it was written, so the page draws it in its place in the chat.
    expect(second).toEqual({
      state: "replied",
      workingAt: 1,
      replies: [
        { text: "One", at: 2 },
        { text: "Two", at: 3 },
      ],
    });
    expect(replyAfter(second, reply("settled"), 4)).toMatchObject({
      settled: true,
      settledAt: 4,
      replies: [{}, {}],
    });
  });

  it("puts a working reply's blocks in place of the last as its progress, and a reply ends it", () => {
    const command = commandOf(["reply", "s.json", "n", "working", "--blocks", "p.json"]);
    expect(command).toMatchObject({ state: "working", blocks: "p.json" });
    if (command?.kind !== "reply") return;
    const plan = (state: "doing" | "done") =>
      [{ kind: "plan", items: [{ text: "Make it bold", state }] }] as const;
    const first = replyAfter(undefined, command, 1, plan("doing"));
    expect(first).toEqual({ state: "working", workingAt: 1, progress: plan("doing") });
    const next = replyAfter(first, command, 2, plan("done"));
    expect(next).toEqual({ state: "working", workingAt: 2, progress: plan("done") });
    const replied = replyAfter(next, { ...command, state: "replied", text: "Bold" }, 3);
    expect(replied).toEqual({ state: "replied", workingAt: 2, replies: [{ text: "Bold", at: 3 }] });
    expect(replyAfter(next, { ...command, blocks: undefined }, 3)).toEqual({
      state: "working",
      workingAt: 3,
    });
    const settled = replyAfter(next, { ...command, state: "settled" }, 4);
    expect(settled.progress).toBeUndefined();
    expect(commandOf(["reply", "s.json", "n", "settled", "--blocks", "p.json"])).toMatchObject({
      blocks: undefined,
    });
  });

  it("keeps the blocks a reply shows with its words", () => {
    const command = commandOf(["reply", "s.json", "n", "replied", "", "--blocks", "b.json"]);
    expect(command).toMatchObject({ text: "", blocks: "b.json" });
    if (command?.kind !== "reply") return;
    const blocks = [{ kind: "followups", items: ["Yes"] }] as const;
    expect(replyAfter(undefined, command, 1, blocks)).toEqual({
      state: "replied",
      replies: [{ text: "", at: 1, blocks }],
    });
  });
});
