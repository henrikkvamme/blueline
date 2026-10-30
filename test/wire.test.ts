import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  answeredAt,
  claimedBy,
  cursorAtByte,
  freshFor,
  givenBack,
  lapsed,
  laterOf,
  LEASE_MS,
  NO_CLAIMS,
} from "../bin/claims";
import { takeLines, type Line } from "../bin/lines";
import { listenerPick } from "../bin/listen";
import { reply } from "../bin/reply";
import { claim, claimsPath, feedbackLines, unclaim, withLock } from "../bin/wire";
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

describe("a claim with no answer", () => {
  const lines = linesOf(
    line({ line: "a", id: "note-a", kind: "note" }) +
      line({ line: "b", kind: "settle", settled: true, left: 2 }),
  );
  const held = claimedBy(NO_CLAIMS, "gone", lines, "b", 1_000);

  it("lapses after its lease, so the line goes to the next reader", () => {
    const none = () => false;
    expect(lapsed(lines, held, none, 1_000 + LEASE_MS - 1)).toBe(held);
    const after = lapsed(lines, held, none, 1_000 + LEASE_MS);
    expect(Object.keys(after.claimed)).toEqual(["b"]);
    expect(ids(freshFor(lines, after, "next"))).toEqual(["a"]);
  });

  it("stays while the note got an answer since the claim", () => {
    const answered = (note: string, since: number) =>
      note === "note-a" && answeredAt({ workingAt: 1_500 }, since);
    expect(lapsed(lines, held, answered, 1_000 + LEASE_MS)).toBe(held);
    expect(answeredAt({ replies: [{ at: 999 }] }, 1_000)).toBe(false);
    expect(answeredAt({ settledAt: 1_000 }, 1_000)).toBe(true);
    expect(answeredAt(undefined, 0)).toBe(false);
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

describe("a line given back", () => {
  const lines = linesOf(
    line({ line: "A", kind: "note" }) +
      line({ line: "B", kind: "note" }) +
      line({ line: "C", kind: "note" }),
  );
  const [A, B, C] = lines;

  it("is fresh for every reader, also behind its cursor, until one claims it", () => {
    // The agent pulls A, a hook with the same name claims B, a wake claims C.
    let claims = claimedBy(NO_CLAIMS, "agent", [A!], "A", 1);
    claims = claimedBy(claims, "agent", [B!], "B", 2);
    claims = claimedBy(claims, "wake", [C!], "C", 3);
    // The pull was cancelled: A goes back, and no cursor moves.
    claims = givenBack(claims, "agent", ["A"], 4);
    expect(claims.cursors).toEqual({ agent: "B", wake: "C" });
    expect(ids(freshFor(lines, claims, "agent"))).toEqual(["A"]);
    expect(ids(freshFor(lines, claims, "wake"))).toEqual(["A"]);
    // The wake takes it; it is no longer returned, and nobody else gets it.
    claims = claimedBy(claims, "wake", [A!], undefined, 5);
    expect(claims.returned ?? {}).toEqual({});
    expect(ids(freshFor(lines, claims, "agent"))).toEqual([]);
    expect(ids(freshFor(lines, claims, "wake"))).toEqual([]);
  });

  it("goes back only from the reader that holds it, once", () => {
    const claims = claimedBy(NO_CLAIMS, "agent", [A!], "A", 1);
    expect(givenBack(claims, "other", ["A"], 2)).toBe(claims);
    const back = givenBack(claims, "agent", ["A"], 2);
    expect(back.claimed).toEqual({});
    expect(givenBack(back, "agent", ["A"], 3)).toBe(back);
  });

  it("never moves a cursor back", () => {
    expect(laterOf(lines, "B", "A")).toBe("B");
    expect(laterOf(lines, "A", "C")).toBe("C");
    expect(laterOf(lines, undefined, "A")).toBe("A");
    // A cursor the file no longer has: the file was started again.
    expect(laterOf(lines, "gone", "A")).toBe("A");
    expect(laterOf(lines, "B", undefined)).toBe("B");
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
  it("reads a claims file as W0 wrote it, and keeps its fields", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const feedback = path.join(dir, "feedback.jsonl");
    writeFileSync(feedback, line({ line: "a", kind: "note" }) + line({ line: "b", kind: "note" }));
    const w0 = { cursors: { other: "a" }, claimed: { a: { by: "other", at: 1 } } };
    writeFileSync(claimsPath(feedback), JSON.stringify(w0));
    const takeAll = claim(feedback, "me", (fresh) => ({ take: fresh, through: fresh.at(-1)?.id }));
    expect(ids(await run(takeAll))).toEqual(["b"]);
    const written = JSON.parse(readFileSync(claimsPath(feedback), "utf8"));
    expect(written.cursors).toEqual({ other: "a", me: "b" });
    expect(written.claimed.a).toEqual({ by: "other", at: 1 });
    expect(written.returned).toBeUndefined();
  });

  it("gives lines back to the next reader, and tells the receipt what it took", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const feedback = path.join(dir, "feedback.jsonl");
    writeFileSync(feedback, line({ line: "A", kind: "note" }));
    const takeAll = (reader: string, receipt?: (taken: readonly Line[]) => void) =>
      claim(feedback, reader, (fresh) => ({ take: fresh, through: fresh.at(-1)?.id }), receipt);
    let receipt: readonly Line[] = [];
    expect(ids(await run(takeAll("agent", (taken) => (receipt = taken))))).toEqual(["A"]);
    expect(ids(receipt)).toEqual(["A"]);
    writeFileSync(feedback, line({ line: "A", kind: "note" }) + line({ line: "B", kind: "note" }));
    expect(ids(await run(takeAll("wake")))).toEqual(["B"]);
    await run(unclaim(feedback, "agent", ids(receipt)));
    // The wake's cursor is past A; it still gets A, and does not move back.
    expect(ids(await run(takeAll("wake")))).toEqual(["A"]);
    expect(ids(await run(takeAll("agent")))).toEqual([]);
    expect(JSON.parse(readFileSync(claimsPath(feedback), "utf8")).cursors.wake).toBe("B");
  });

  it("keeps the receipt of a claim that is stopped while it writes", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const feedback = path.join(dir, "feedback.jsonl");
    writeFileSync(feedback, line({ line: "A", kind: "note" }));
    // Stopped after 0 to 40 turns of the scheduler: the claim is whole or none, and its
    // receipt says which.
    for (let turns = 0; turns <= 40; turns += 1) {
      rmSync(claimsPath(feedback), { force: true });
      let receipt: readonly Line[] = [];
      await run(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(
            claim(
              feedback,
              "agent",
              (fresh) => ({ take: fresh, through: fresh.at(-1)?.id }),
              (taken) => (receipt = taken),
            ),
          );
          for (let t = 0; t < turns; t += 1) yield* Effect.yieldNow;
          yield* Fiber.interrupt(fiber);
        }),
      );
      const written = existsSync(claimsPath(feedback))
        ? JSON.parse(readFileSync(claimsPath(feedback), "utf8"))
        : NO_CLAIMS;
      const claimed = ids(await run(feedbackLines(feedback))).filter(
        (id) => written.claimed[id] !== undefined,
      );
      expect(ids(receipt)).toEqual(claimed);
    }
  });

  it("fails a claim whose claims file cannot be written, and keeps the lines", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const feedback = path.join(dir, "feedback.jsonl");
    writeFileSync(feedback, line({ line: "A", kind: "note" }));
    // A folder where the file goes: the rename fails.
    mkdirSync(claimsPath(feedback));
    let receipt: readonly Line[] = [];
    const takeAll = claim(
      feedback,
      "agent",
      (fresh) => ({ take: fresh, through: fresh.at(-1)?.id }),
      (taken) => (receipt = taken),
    );
    expect(
      await run(
        takeAll.pipe(
          Effect.as("took"),
          Effect.orElseSucceed(() => "failed"),
        ),
      ),
    ).toBe("failed");
    expect(receipt).toEqual([]);
    rmSync(claimsPath(feedback), { recursive: true });
    expect(ids(await run(takeAll))).toEqual(["A"]);
  });
  it("gives a listener a line given back, with no new line in the feedback file", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "blueline-wire-"));
    const feedback = path.join(dir, "feedback.jsonl");
    writeFileSync(feedback, line({ line: "A", kind: "note" }));
    const takeAll = claim(feedback, "agent", (fresh) => ({ take: fresh, through: "A" }));
    expect(ids(await run(takeAll))).toEqual(["A"]);
    const command = path.join(import.meta.dirname, "..", "bin", "blueline.ts");
    const listener = spawn(process.execPath, [command, "listen", feedback, "--as", "wake"]);
    try {
      let out = "";
      const printed = (text: string) =>
        new Promise<void>((done) => {
          const look = () => out.includes(text) && done();
          listener.stdout.on("data", (chunk: Buffer) => {
            out += chunk.toString();
            look();
          });
          look();
        });
      await printed("[listening]");
      await run(unclaim(feedback, "agent", ["A"]));
      await printed('"line":"A"');
    } finally {
      listener.kill();
    }
  }, 10_000);
});
