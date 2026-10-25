import { describe, expect, it } from "vitest";
import { ageOf, cameLate, commandOf, replyAfter, takeLines, wakes } from "../bin/lines";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("the agent's side of the channel", () => {
  it("reads whole lines, and leaves a line the server still writes for the next read", () => {
    const one = '{"journey":"preparation","sentAt":"2026-10-20T19:13:10.380Z","id":"a"}\n';
    const { lines, used } = takeLines(bytes(`${one}not json\n{"journey":"pre`));
    expect(lines).toEqual([
      { raw: one.trim(), start: 0, journey: "preparation", sentAt: "2026-10-20T19:13:10.380Z" },
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
    expect(second).toEqual({ state: "replied", replies: [{ text: "One" }, { text: "Two" }] });
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
    expect(first).toEqual({ state: "working", progress: plan("doing") });
    const next = replyAfter(first, command, 2, plan("done"));
    expect(next).toEqual({ state: "working", progress: plan("done") });
    const replied = replyAfter(next, { ...command, state: "replied", text: "Bold" }, 3);
    expect(replied).toEqual({ state: "replied", replies: [{ text: "Bold" }] });
    expect(replyAfter(next, { ...command, blocks: undefined }, 3)).toEqual({ state: "working" });
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
      replies: [{ text: "", blocks }],
    });
  });
});
