import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { RequestId } from "@modelcontextprotocol/server";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { commandOf } from "../bin/lines";
import { waitHandler, type Delivery } from "../bin/mcp";
import { claim, claimsPath } from "../bin/wire";
import { NOTHING_NEW } from "../src/mcp/tools";
import TOOLS from "./fixtures/mcp-tools.json" with { type: "json" };

/*
 * `blueline mcp` from the source, as an agent's harness runs it: a child process that speaks
 * MCP on its standard input and output, on a feedback file in a folder of its own.
 */

const COMMAND = path.join(import.meta.dirname, "..", "bin", "blueline.ts");
const line = (fields: object) => `${JSON.stringify(fields)}\n`;
const note = (id: string, more: object = {}) =>
  line({ line: id, kind: "note", id: `note-${id}`, journey: "j", ...more });
const settle = (id: string, left: number) =>
  line({ line: id, kind: "settle", journey: "j", settled: true, left });

const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
/** What another reader, as a wake, takes now: every fresh line. */
const wake = (feedback: string, reader = "wake") =>
  run(claim(feedback, reader, (fresh) => ({ take: fresh, through: fresh.at(-1)?.id }))).then(
    (taken) => taken.map((l) => l.id),
  );

let dir = "";
let feedback = "";
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  rmSync(dir, { recursive: true, force: true });
});

function folder() {
  dir = mkdtempSync(path.join(tmpdir(), "blueline-mcp-"));
  feedback = path.join(dir, ".blueline", "feedback.jsonl");
  mkdirSync(path.dirname(feedback));
  writeFileSync(feedback, "");
}

async function connect(...flags: string[]) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [COMMAND, "mcp", feedback, "--as", "agent", ...flags],
      cwd: dir,
      stderr: "pipe",
    }),
  );
  clients.push(client);
  return client;
}

const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
const waitFor = (client: Client, options?: { signal?: AbortSignal }) =>
  client.callTool({ name: "wait_for_feedback", arguments: {} }, options);

describe("the words of blueline mcp", () => {
  it("are the fixture's, and never change in a session", async () => {
    folder();
    const client = await connect();
    expect(client.getInstructions()).toBe(TOOLS.instructions);
    expect((await client.listTools()).tools).toEqual(TOOLS.tools);
    expect(client.getServerCapabilities()?.tools).toEqual({ listChanged: false });
  });

  it("are the same over the 2025 protocol, with no list_changed", async () => {
    folder();
    const child = spawn(process.execPath, [COMMAND, "mcp", feedback], { cwd: dir });
    const messages: Array<{ id?: number; method?: string; result?: { tools?: unknown } }> = [];
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const lines = out.split("\n");
      out = lines.pop() ?? "";
      for (const raw of lines) if (raw.trim() !== "") messages.push(JSON.parse(raw));
    });
    const send = (message: object) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw", version: "1" },
      },
    });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list", params: {} });
    send({
      id: 3,
      method: "tools/call",
      params: { name: "reply", arguments: { id: "x", state: "settled" } },
    });
    while (!messages.some((m) => m.id === 3)) await new Promise((done) => setTimeout(done, 20));
    child.stdin.end();
    await new Promise((done) => child.once("exit", done));
    expect(messages.find((m) => m.id === 2)?.result?.tools).toEqual(TOOLS.tools);
    expect(messages.filter((m) => m.method !== undefined)).toEqual([]);
  });
});

describe("wait_for_feedback", () => {
  it("ends at a note, with the settles before it, each tagged", async () => {
    folder();
    const client = await connect();
    const waiting = waitFor(client);
    await new Promise((done) => setTimeout(done, 300));
    appendFileSync(feedback, settle("S1", 2));
    await new Promise((done) => setTimeout(done, 1_500));
    appendFileSync(feedback, note("N1"));
    const lines = textOf(await waiting).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[status, sent [^\]]+\] \{"line":"S1"/);
    expect(lines[1]).toMatch(/^\[new, sent [^\]]+\] \{"line":"N1"/);
  });

  it("tags the lines from before it listened as old", async () => {
    folder();
    appendFileSync(feedback, note("N1"));
    const client = await connect();
    expect(textOf(await waitFor(client))).toMatch(/^\[old, sent [^\]]+, before you listened\] /);
  });

  it("is not ended by a settle that leaves steps open, and is by the finish alone", async () => {
    folder();
    const client = await connect("--wait", "2");
    appendFileSync(feedback, settle("S1", 1));
    expect(textOf(await waitFor(client))).toBe(NOTHING_NEW);
    appendFileSync(feedback, settle("S2", 0));
    const lines = textOf(await waitFor(client)).split("\n");
    expect(lines.map((l) => JSON.parse(l.slice(l.indexOf("] ") + 2)).line)).toEqual(["S1", "S2"]);
  });

  it("returns the same line when nothing comes in time", async () => {
    folder();
    const client = await connect("--wait", "1");
    const started = performance.now();
    expect(textOf(await waitFor(client))).toBe(NOTHING_NEW);
    expect(performance.now() - started).toBeLessThan(2_500);
  });

  it("gives a pulled line to no wake, no next call and no hook of the same name", async () => {
    folder();
    appendFileSync(feedback, note("N1"));
    const client = await connect("--wait", "1");
    expect(textOf(await waitFor(client))).toContain('"line":"N1"');
    expect(await wake(feedback)).toEqual([]);
    expect(await wake(feedback, "agent")).toEqual([]);
    expect(textOf(await waitFor(client))).toBe(NOTHING_NEW);
  });

  it("does not give a line that a wake took first", async () => {
    folder();
    appendFileSync(feedback, note("N1"));
    expect(await wake(feedback)).toEqual(["N1"]);
    const client = await connect("--wait", "1");
    expect(textOf(await waitFor(client))).toBe(NOTHING_NEW);
  });

  it("gives each line to the pull or to a wake that runs at the same time, never both", async () => {
    folder();
    const client = await connect("--wait", "1");
    for (let round = 0; round < 8; round += 1) {
      appendFileSync(feedback, note(`N${String(round)}`));
      const [pulled, woke] = await Promise.all([
        waitFor(client).then(textOf),
        // Half the rounds, the wake starts first.
        new Promise((done) => setTimeout(done, round % 2 === 0 ? 0 : 5)).then(() => wake(feedback)),
      ]);
      const byPull = pulled === NOTHING_NEW ? [] : [`N${String(round)}`];
      expect([...byPull, ...woke]).toEqual([`N${String(round)}`]);
    }
  });

  it("claims nothing for a call the client cancels", async () => {
    folder();
    const client = await connect();
    const stop = new AbortController();
    const waiting = waitFor(client, { signal: stop.signal }).catch(() => "cancelled");
    await new Promise((done) => setTimeout(done, 300));
    stop.abort();
    expect(await waiting).toBe("cancelled");
    appendFileSync(feedback, note("N1"));
    await new Promise((done) => setTimeout(done, 1_500));
    expect(await wake(feedback)).toEqual(["N1"]);
  });

  it("ends the process when its input ends, and claims nothing after", async () => {
    folder();
    const child = spawn(process.execPath, [COMMAND, "mcp", feedback], { cwd: dir });
    const send = (message: object) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw", version: "1" },
      },
    });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/call", params: { name: "wait_for_feedback", arguments: {} } });
    await new Promise((done) => setTimeout(done, 500));
    const started = performance.now();
    const exited = new Promise<number | null>((done) => child.once("exit", done));
    child.stdin.end();
    expect(await exited).toBe(0);
    expect(performance.now() - started).toBeLessThan(1_500);
    appendFileSync(feedback, note("N1"));
    expect(await wake(feedback)).toEqual(["N1"]);
  });

  it("says when it cannot claim, and keeps the lines for the next call", async () => {
    folder();
    appendFileSync(feedback, note("N1"));
    // A folder where the claims file goes: its write fails.
    mkdirSync(claimsPath(feedback));
    const client = await connect("--wait", "1");
    const failed = await waitFor(client);
    expect(failed.isError).toBe(true);
    rmSync(claimsPath(feedback), { recursive: true });
    expect(textOf(await waitFor(client))).toContain('"line":"N1"');
  });
});

describe("a wait the client cancels", () => {
  /*
   * The handler as the SDK runs it: the SDK sends the result only when the request's signal
   * has not aborted, and the transport marks the call delivered then. Each line is either in
   * a result that went, or back for a wake.
   */
  async function cancelled(when: "before the claim" | "after the claim" | "after the result went") {
    folder();
    appendFileSync(feedback, note("N1"));
    const stop = new AbortController();
    const watched = new Map<RequestId, Delivery>();
    const givingBack = new Set<Promise<unknown>>();
    const services = await run(Effect.context<NodeServices.NodeServices>());
    const real = Effect.runPromiseExitWith(services);
    const handler = waitHandler({
      // The pull ends with the claim made; the abort comes right then, before the SDK looks.
      run: (effect, options) =>
        real(
          when === "after the claim"
            ? effect.pipe(Effect.tap(() => Effect.sync(() => stop.abort())))
            : effect,
          options,
        ),
      feedback,
      journey: undefined,
      name: "agent",
      waitMs: 1_000,
      reader: { first: true },
      watched,
      givingBack,
    });
    if (when === "before the claim") stop.abort();
    const result = await handler({ signal: stop.signal, id: 1 });
    let went = "";
    if (!stop.signal.aborted) {
      const delivery = watched.get(1);
      if (delivery !== undefined) delivery.sent = true;
      went = textOf(result);
    }
    if (when === "after the result went") stop.abort();
    while (givingBack.size > 0) await Promise.all(givingBack);
    return { went, back: await wake(feedback) };
  }

  it("claims nothing when it was cancelled before its claim", async () => {
    expect(await cancelled("before the claim")).toEqual({ went: "", back: ["N1"] });
  });

  it("gives the lines back when it was cancelled after its claim, before the result went", async () => {
    expect(await cancelled("after the claim")).toEqual({ went: "", back: ["N1"] });
  });

  it("keeps the lines whose result went", async () => {
    const { went, back } = await cancelled("after the result went");
    expect(went).toContain('"line":"N1"');
    expect(back).toEqual([]);
  });
});

describe("reply", () => {
  const status = () => JSON.parse(readFileSync(path.join(dir, ".blueline", "status.json"), "utf8"));

  it("writes the status file as blueline reply does, for each state", async () => {
    folder();
    const client = await connect();
    const plan = [{ kind: "plan", items: [{ text: "Move the button", state: "doing" }] }];
    const call = (args: Record<string, unknown>) =>
      client.callTool({ name: "reply", arguments: args });
    expect((await call({ id: "note-a", state: "working", blocks: plan })).isError).toBeFalsy();
    expect(status()["note-a"]).toEqual({
      state: "working",
      workingAt: expect.any(Number),
      progress: plan,
    });
    await call({ id: "note-a", state: "replied", text: "Moved", variant: "B" });
    expect(status()["note-a"]).toEqual({
      state: "replied",
      workingAt: expect.any(Number),
      replies: [{ text: "Moved", at: expect.any(Number), variant: "B" }],
    });
    await call({ id: "note-a", state: "settled" });
    expect(status()["note-a"]).toMatchObject({ state: "replied", settled: true });
  });

  it("says what is wrong with an answer, and writes nothing", async () => {
    folder();
    const client = await connect();
    const call = (args: Record<string, unknown>) =>
      client.callTool({ name: "reply", arguments: args });
    for (const wrong of [
      { id: "n", state: "replied" },
      { id: "n", state: "settled", text: "Done" },
      { id: "n", state: "working", text: "On it" },
      { id: "n", state: "working", blocks: [{ kind: "nothing" }] },
      { id: "n", state: "maybe" },
    ]) {
      const result = await call(wrong);
      expect(result.isError).toBe(true);
      expect(textOf(result)).not.toBe("");
    }
    expect(() => status()).toThrow();
  });
});

describe("apply", () => {
  const CARD = `import { variants } from "@henrikkvamme/blueline/variants";

export const Card = variants<{ p: number }>("Card", {
  A: (p) => <div className="a" />,
  B: (p) => <div className="b" />,
});
`;
  const verdicts = (kept: string[]) =>
    note("V", { parts: { Card: { kept, dropped: ["A", "B"].filter((v) => !kept.includes(v)) } } });

  it("returns the changes, says when there are no verdicts, and asks which to keep", async () => {
    folder();
    writeFileSync(path.join(dir, "card.tsx"), CARD);
    const client = await connect();
    const call = (args: Record<string, unknown>) =>
      client.callTool({ name: "apply", arguments: args });
    expect(textOf(await call({ part: "Card" }))).toBe("The reviewer has no verdicts on Card yet.");
    appendFileSync(feedback, verdicts(["A", "B"]));
    const ask = await call({ part: "Card" });
    expect(ask.isError).toBe(true);
    expect(textOf(ask)).toMatch(/keep/);
    expect(textOf(await call({ part: "Card", keep: "B" }))).toMatch(/Card is now "B" alone/);
    expect(readFileSync(path.join(dir, "card.tsx"), "utf8")).toContain('className="b"');
  });
});

describe("the mcp command line", () => {
  it("reads each flag, and refuses a wait out of range", () => {
    expect(commandOf(["mcp", "f.jsonl"])).toEqual({
      kind: "mcp",
      file: "f.jsonl",
      journey: undefined,
      name: "agent",
      status: undefined,
      src: ".",
      waitMs: 50_000,
    });
    expect(
      commandOf([
        "mcp",
        "f.jsonl",
        "--journey",
        "j",
        "--status",
        "s.json",
        "--src",
        "app",
        "--wait",
        "240",
      ]),
    ).toEqual({
      kind: "mcp",
      file: "f.jsonl",
      journey: "j",
      name: "j",
      status: "s.json",
      src: "app",
      waitMs: 240_000,
    });
    expect(commandOf(["mcp", "f.jsonl", "--as", "me"])).toMatchObject({ name: "me" });
    for (const wait of ["0", "3541", "1.5", "soon"])
      expect(commandOf(["mcp", "f.jsonl", "--wait", wait])).toBeUndefined();
    expect(commandOf(["mcp"])).toBeUndefined();
  });
});
