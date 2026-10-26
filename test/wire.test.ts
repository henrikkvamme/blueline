import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { claimedBy, cursorAtByte, freshFor, NO_CLAIMS } from "../bin/claims";
import { takeLines, type Line } from "../bin/lines";
import { listenerPick } from "../bin/listen";
import { reply } from "../bin/reply";
import { claim, feedbackLines, withLock } from "../bin/wire";
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

  it("is its place in bytes and its hash for a line from before the stamp", () => {
    const text = line({ kind: "note", text: "Gjør" }) + line({ kind: "settle", line: "S" });
    const [old, stamp] = ids(linesOf(text));
    expect(old).toMatch(/^@0:[0-9a-z]+$/);
    expect(stamp).toBe("S");
    // Another line in the same place, as in a file started again, has another ID.
    expect(ids(linesOf(line({ kind: "note", text: "Ny" })))[0]).not.toBe(old);
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

  const script = path.join(import.meta.dirname, "fixtures", "hold-lock.ts");
  /** Whether this process gets the lock within the time. */
  const gets = (file: string, ms: number) =>
    run(
      withLock(file, Effect.succeed(true)).pipe(
        Effect.timeoutOrElse({ duration: ms, orElse: () => Effect.succeed(false) }),
      ),
    );

  it("lets one fiber at a time hold it", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const file = path.join(dir, "status.json");
    let holding = 0;
    let most = 0;
    const use = Effect.gen(function* () {
      holding += 1;
      most = Math.max(most, holding);
      yield* Effect.sleep("5 millis");
      holding -= 1;
    });
    await run(
      Effect.forEach(Array.from({ length: 8 }), () => withLock(file, use), {
        concurrency: "unbounded",
      }),
    );
    expect(most).toBe(1);
  });

  it("lets one process at a time hold it", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const file = path.join(dir, "status.json");
    const log = path.join(dir, "log");
    await Promise.all(
      Array.from(
        { length: 6 },
        () =>
          new Promise<void>((done, fail) =>
            spawn(process.execPath, [script, file, log], { stdio: "inherit" }).on("exit", (code) =>
              code === 0 ? done() : fail(new Error(`exit ${String(code)}`)),
            ),
          ),
      ),
    );
    const marks = readFileSync(log, "utf8").trim().split("\n");
    expect(marks).toHaveLength(60);
    // Each holder goes out before the next goes in.
    marks.forEach((m, i) => {
      if (i % 2 === 1) expect(m).toBe(`-${(marks[i - 1] ?? "").slice(1)}`);
    });
  }, 30_000);

  it("keeps a live process's lock, and frees it when that process is killed", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const file = path.join(dir, "status.json");
    const holder = spawn(process.execPath, [script, file, "hold"]);
    await new Promise<void>((done) => holder.stdout.once("data", () => done()));
    expect(await gets(file, 300)).toBe(false);
    holder.kill("SIGKILL");
    await new Promise((done) => holder.once("exit", done));
    expect(await gets(file, 2_000)).toBe(true);
  }, 15_000);

  it("leaves no lock behind when a fiber is stopped while it takes or holds it", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const file = path.join(dir, "status.json");
    // Stopped after 0 to 11 turns of the scheduler: at each step of taking the lock.
    await run(
      Effect.forEach(
        Array.from({ length: 48 }, (_, i) => i % 12),
        (turns) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(withLock(file, Effect.sleep("2 millis")));
            for (let t = 0; t < turns; t += 1) yield* Effect.yieldNow;
            yield* Fiber.interrupt(fiber);
          }),
      ),
    );
    expect(await gets(file, 500)).toBe(true);
  });

  it("stops waiting at once when it is stopped while another holds the lock", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const file = path.join(dir, "status.json");
    const other = new DatabaseSync(`${file}.lock`);
    other.exec("BEGIN IMMEDIATE");
    try {
      const started = performance.now();
      expect(await gets(file, 100)).toBe(false);
      expect(performance.now() - started).toBeLessThan(1_000);
    } finally {
      other.exec("ROLLBACK");
      other.close();
    }
    expect(await gets(file, 500)).toBe(true);
  });

  it("starts at a read mark from before the claims, and at the top when the mark is past the end", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const feedback = path.join(dir, "feedback.jsonl");
    const first = line({ line: "a", kind: "note" });
    writeFileSync(feedback, first + line({ line: "b", kind: "note" }));
    const takeAll = (reader: string) =>
      claim(feedback, reader, (fresh) => ({ take: fresh, through: fresh.at(-1)?.id }));
    writeFileSync(`${feedback}.read.json`, JSON.stringify({ old: first.length, far: 10_000 }));
    expect(ids(await run(takeAll("old")))).toEqual(["b"]);
    writeFileSync(`${feedback}.claims.json`, JSON.stringify({ cursors: {}, claimed: {} }));
    expect(ids(await run(takeAll("far")))).toEqual(["a", "b"]);
  });

  it("fails on a read that fails, rather than take it for an empty file", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const feedback = path.join(dir, "feedback.jsonl");
    mkdirSync(feedback);
    const read = claim(feedback, "me", (fresh) => ({ take: fresh, through: undefined }));
    expect(
      await run(
        read.pipe(
          Effect.as("read"),
          Effect.orElseSucceed(() => "failed"),
        ),
      ),
    ).toBe("failed");
  });
});
