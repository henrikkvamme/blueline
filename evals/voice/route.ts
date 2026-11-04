import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

/*
 * The routing eval (ADR 0008): does the voice model call the right tool, with the right
 * arguments, for what he says? Each case gives the model the page as the workshop describes
 * it, then his words as speech at the pace of speech, then the release. The key comes from
 * the dev server's /__realtime/token, so the eval tests the session the workshop gets: its
 * instructions, its tools and its app map. Run it after a change to any of them.
 *
 *   node evals/voice/route.ts --url http://127.0.0.1:4311 [--reps 1] [--only id,id]
 *
 * Speech is ElevenLabs text to speech, kept under evals/voice/audio/ (out of git). Only a new
 * line needs ELEVENLABS_API_KEY.
 */

const DIR = path.join(import.meta.dirname, "audio");
const RUNS = path.join(import.meta.dirname, "runs");
/** ElevenLabs' George, the voice of the hearing evals. */
const VOICE = "JBFqnCBsd6RMkjVDRZzb";
const RATE = 24_000;

const { values: flags } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:4311" },
    reps: { type: "string", default: "1" },
    only: { type: "string" },
  },
});

const PARTS = [
  'the title [data-q="title"]',
  'who asked [data-q="asker"]',
  'the status [data-q="status"]',
  'the amount [data-q="amount"]',
  'the approvers [data-q="approvers"]',
  'the send button [data-q="submit"]',
  'the Request tab [data-q="tab-request"]',
  'the Approvers tab [data-q="tab-approvers"]',
  'the Sent tab [data-q="tab-sent"]',
].join("; ");

/** The page as the workshop describes it to the voice model, before his words. */
const PAGES = {
  journey: [
    "The page: /request.",
    "The open remark: “Try it: let me click a journey”, a look. Ask the agent to show a journey. It says each click, then makes it.",
    "He pointed at, while he spoke: nothing.",
    `Parts of the page: ${PARTS}.`,
    "Remarks after this one: 6.",
  ],
  status: [
    "The page: /request.",
    "The open remark: “How should the status look?”, a choice. Three looks for the request's status.",
    "Its variants: 1 “Dot”, 2 “Pill”, 3 “Steps”.",
    "Its states: 1 “In review”, 2 “Waits for Ingrid Berg”, 3 “Approved”, 4 “Sent back”.",
    "Shown now: “Pill”.",
    'He pointed at, while he spoke: the status [data-q="status"].',
    `Parts of the page: ${PARTS}.`,
    "Remarks after this one: 5.",
  ],
} as const;

interface Call {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

interface Case {
  readonly id: string;
  readonly page: keyof typeof PAGES;
  readonly said: string;
  readonly tool: string;
  /** What the arguments must hold, in words, and the check. */
  readonly holds?: readonly [string, (args: Call["args"]) => boolean];
}

interface Step {
  readonly part?: unknown;
  readonly do?: unknown;
}

const steps = (args: Call["args"]): readonly Step[] =>
  Array.isArray(args["steps"]) ? (args["steps"] as Step[]) : [];
const visits = (args: Call["args"], ...parts: readonly string[]) => {
  const order = steps(args).map((s) => s.part);
  let at = 0;
  for (const part of parts) {
    at = order.indexOf(part, at);
    if (at < 0) return false;
  }
  return true;
};
/** The steps on these parts are all of one kind: his clicks, or the walk's own. */
const all = (args: Call["args"], how: string, ...parts: readonly string[]) =>
  steps(args)
    .filter((s) => typeof s.part === "string" && parts.includes(s.part))
    .every((s) => s.do === how);

const CASES: readonly Case[] = [
  { id: "next", page: "journey", said: "Go to the next one.", tool: "next" },
  { id: "back", page: "journey", said: "Go back.", tool: "back" },
  { id: "settle", page: "status", said: "Looks good.", tool: "settle" },
  { id: "undo", page: "status", said: "Undo that.", tool: "undo" },
  {
    id: "preview",
    page: "status",
    said: "Show me the third one.",
    tool: "preview",
    holds: ["n is 3", (a) => a["n"] === 3],
  },
  { id: "keep", page: "status", said: "Keep this one.", tool: "keep" },
  {
    id: "state",
    page: "status",
    said: "Show it when it's sent back.",
    tool: "state",
    holds: ["n is 4", (a) => a["n"] === 4],
  },
  {
    id: "state-approved",
    page: "status",
    said: "What would it look like after Ingrid approves it?",
    tool: "state",
    holds: ["n is 3", (a) => a["n"] === 3],
  },
  {
    id: "point",
    page: "journey",
    said: "Point at the amount.",
    tool: "point",
    holds: ["target is the amount", (a) => /amount/.test(String(a["target"]))],
  },
  { id: "pause", page: "status", said: "Pause.", tool: "pause" },
  { id: "play", page: "status", said: "Play the walk again.", tool: "play" },
  {
    id: "teach",
    page: "journey",
    said: "Show me how I add an approver and send this.",
    tool: "walk",
    holds: [
      "visits add, then submit; he clicks both",
      (a) => visits(a, "add", "submit") && all(a, "turn", "add", "submit"),
    ],
  },
  {
    id: "click-through",
    page: "journey",
    said: "Click through adding an approver and sending it for me.",
    tool: "walk",
    holds: [
      "visits add, then submit; the walk clicks both",
      (a) => visits(a, "add", "submit") && all(a, "click", "add", "submit"),
    ],
  },
  {
    id: "ask-page",
    page: "status",
    said: "What does waits for Ingrid mean?",
    tool: "ask_deep_agent",
    holds: ["depth is quick", (a) => a["depth"] === "quick"],
  },
  {
    id: "ask-mockup",
    page: "status",
    said: "Mock up the amount in euros.",
    tool: "ask_deep_agent",
    holds: ["depth is deep", (a) => a["depth"] === "deep"],
  },
  {
    id: "ask-code",
    page: "journey",
    said: "How does the code decide which remark comes next?",
    tool: "ask_deep_agent",
    holds: ["depth is deep", (a) => a["depth"] === "deep"],
  },
];

async function pcm(text: string): Promise<Buffer> {
  const file = path.join(
    DIR,
    `${Buffer.from(`${VOICE} ${RATE} ${text}`).toString("base64url")}.pcm`,
  );
  if (existsSync(file)) return readFileSync(file);
  const key = process.env["ELEVENLABS_API_KEY"] ?? "";
  if (key === "") throw new Error(`Set ELEVENLABS_API_KEY to speak "${text}"`);
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=pcm_${String(RATE)}`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_v4" }),
    },
  );
  if (!r.ok) throw new Error(`Text to speech ${String(r.status)}: ${await r.text()}`);
  const lead = Buffer.alloc(Math.round(RATE * 0.3) * 2);
  const audio = Buffer.concat([lead, Buffer.from(await r.arrayBuffer())]);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, audio);
  return audio;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Result {
  readonly id: string;
  readonly said: string;
  readonly want: string;
  readonly got?: Call;
  readonly heard?: string;
  /** From the release to the tool call, in ms. */
  readonly ms?: number;
  readonly pass: boolean;
  readonly why?: string;
}

async function run(c: Case): Promise<Result> {
  const audio = await pcm(c.said);
  const token = await fetch(`${flags.url}/__realtime/token?voice=marin`, { method: "POST" });
  if (!token.ok) throw new Error(`Token ${String(token.status)}: is the dev server up?`);
  const { value, model } = (await token.json()) as { value: string; model: string };
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, [
    "realtime",
    `openai-insecure-api-key.${value}`,
  ]);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Could not open the session")), {
      once: true,
    });
  });
  const send = (event: object) => ws.send(JSON.stringify(event));
  let released = 0;
  let got: Call | undefined;
  let ms: number | undefined;
  let heard: string | undefined;
  let error: string | undefined;
  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 20_000);
    ws.addEventListener("message", (m) => {
      const e = JSON.parse(String(m.data)) as Record<string, any>;
      if (e["type"] === "error") error = String(e["error"]?.message ?? "error");
      else if (e["type"] === "conversation.item.input_audio_transcription.completed")
        heard = String(e["transcript"]).trim();
      else if (e["type"] === "response.output_item.done" && e["item"]?.type === "function_call") {
        ms ??= Math.round(performance.now() - released);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(e["item"].arguments ?? "{}") as Record<string, unknown>;
        } catch {
          // Broken arguments fail the case's check.
        }
        got ??= { tool: String(e["item"].name), args };
      } else if (e["type"] === "response.done") {
        clearTimeout(timer);
        // The transcript may come just after the answer.
        setTimeout(resolve, heard === undefined ? 1500 : 0);
      }
    });
  });
  // As the workshop does: the page first, then his voice, then the release.
  send({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: PAGES[c.page].join("\n") }],
    },
  });
  const size = Math.round(RATE * 0.04) * 2;
  const start = performance.now();
  for (let at = 0, i = 0; at < audio.length; at += size, i++) {
    send({
      type: "input_audio_buffer.append",
      audio: audio.subarray(at, at + size).toString("base64"),
    });
    await wait(Math.max(0, start + (i + 1) * 40 - performance.now()));
  }
  released = performance.now();
  send({ type: "input_audio_buffer.commit" });
  send({ type: "response.create" });
  await done;
  ws.close();
  // Without the app's map the session has no walk, so a journey goes to the deep agent.
  const want = !mapped && c.tool === "walk" ? "ask_deep_agent" : c.tool;
  const base = { id: c.id, said: c.said, want, ...(heard === undefined ? {} : { heard }) };
  if (got === undefined) return { ...base, pass: false, why: error ?? "no tool" };
  const call = got;
  const right = call.tool === want;
  const holds = c.holds === undefined || want !== c.tool || (right && c.holds[1](call.args));
  return {
    ...base,
    got: call,
    ...(ms === undefined ? {} : { ms }),
    pass: right && holds,
    ...(right
      ? holds
        ? {}
        : { why: `not ${c.holds?.[0] ?? ""}` }
      : { why: `called ${call.tool}` }),
  };
}

/** Runs the jobs, a few at a time, so a run takes well under a minute. */
async function inParallel<T>(jobs: readonly (() => Promise<T>)[], width: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < jobs.length) {
        const i = next++;
        const job = jobs[i];
        if (job !== undefined) out[i] = await job();
      }
    }),
  );
  return out;
}

const only = flags.only?.split(",");
const chosen = CASES.filter((c) => only === undefined || only.includes(c.id));
const reps = Number(flags.reps);
const mapped = (await fetch(`${flags.url}/__realtime/map`).catch(() => undefined))?.ok === true;
console.log(
  mapped
    ? "The session has the app's map.\n"
    : "No app map yet: a journey goes to the deep agent.\n",
);
// ElevenLabs allows a few requests at a time, so new speech is made one line at a time.
for (const c of chosen) await pcm(c.said);
const results = await inParallel(
  chosen.flatMap((c) => Array.from({ length: reps }, () => () => run(c))),
  6,
);

for (const r of results) {
  const args = r.got === undefined ? "" : JSON.stringify(r.got.args).slice(0, 70);
  console.log(
    `${r.pass ? "ok  " : "FAIL"} ${r.id.padEnd(14)} ${(r.got?.tool ?? "-").padEnd(15)} ${String(r.ms ?? "-").padStart(5)} ms  ${r.why ?? args}`,
  );
  if (!r.pass && r.heard !== undefined) console.log(`     heard: ${r.heard}`);
}
const times = results.flatMap((r) => (r.ms === undefined ? [] : [r.ms])).sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)] ?? 0;
const passed = results.filter((r) => r.pass).length;
console.log(`\n${String(passed)}/${String(results.length)} right, median ${String(median)} ms`);
mkdirSync(RUNS, { recursive: true });
const file = path.join(RUNS, `route-${new Date().toISOString().replaceAll(":", "-")}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(file);
process.exitCode = passed === results.length ? 0 : 1;
