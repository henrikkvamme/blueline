/*
 * The hearing evals in a real browser: the whole way from the keys to the line on screen,
 * through the dev server, as Henrik uses it. For each case, the page's microphone plays the
 * case's audio in real time, from a moment after the page opens it. (Chromium's own fake
 * microphone never opens on fry, so getUserMedia is replaced with a Web Audio stream.) The
 * eval points at the case's element, holds Control and Command while the audio plays, lets
 * go, and takes the page's trace (src/workshop/queue/timing.ts).
 *
 * It also checks the agent's work on each case, from the events it sent back: every selector
 * it used is one of the page's elements, and Claude Opus 5.5 judges whether it did what he
 * asked: a question is answered on the page, and a change to the app goes into the queue.
 * Each case starts a new agent session, so no case sees another.
 *
 *   node examples/review-demo/evals/browser.ts [--url http://localhost:4314] [--only id,id]
 *     [--no-judge]
 *
 * The dev server must run with ELEVENLABS_API_KEY, and the audio must exist: run
 * evals/hearing.ts once first, which speaks each case.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const HERE = join(ROOT, "evals", "hearing");
/** He starts to speak this long after the microphone opens, in s. */
const PAUSE = 0.3;

interface Case {
  readonly id: string;
  readonly said: string;
  readonly context: { readonly pointedWhileSaying: readonly { readonly target: string }[] };
  readonly expect: { readonly kind: string; readonly gist: string };
}
interface AgentEvent {
  readonly type: string;
  readonly text?: string;
  readonly target?: string;
  readonly beats?: readonly { readonly target: string; readonly say: string }[];
  readonly acts?: unknown;
}
interface Trace {
  readonly marks: Partial<Record<string, number>>;
  readonly said?: string;
  readonly line?: string;
  readonly ear?: string;
  readonly server?: { readonly marks: Partial<Record<string, number>>; readonly blocks: string[] };
}

/** The agent's steps, from the dev server's marks and the page's: name, from, to. */
const STEPS = [
  ["run ready", "", "taken"],
  ["Claude Code begins", "taken", "init"],
  ["model's answer begins", "init", "api"],
  ["first block", "api", "block"],
  ["page tool begins", "block", "tool"],
  ["walk's first line written", "tool", "line"],
  ["page tool written", "tool", "input"],
  ["page tool runs", "input", "sent"],
] as const;

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:4314" },
    only: { type: "string" },
    "no-judge": { type: "boolean", default: false },
  },
});

const JUDGE = `You check the agent in a UI review tool. A reviewer pointed at a web page and spoke. For a question, the agent should answer it on the page with a show (its cursor points and a voice speaks), and change nothing. For a change to the app, it should put the change in the queue with annotate, in one clear sentence that keeps what he asked and adds nothing, and may show one short beat that it is on it. Judge whether the agent did what he asked, about the right thing on the page. A doubt, such as "not sure about this colour", may be either answered or put in the queue. Wording does not matter. Reply with JSON only: {"right": true|false, "why": "at most 12 words"}.`;

/** Opus judges the agent's work on one case. */
async function judge(c: Case, events: readonly AgentEvent[]) {
  const did = events.flatMap((e): Record<string, unknown>[] =>
    e.type === "show"
      ? [{ show: e.beats?.map((b) => ({ at: b.target, say: b.say })) }]
      : e.type === "annotate"
        ? [{ annotate: { at: e.target, text: e.text } }]
        : e.type === "act"
          ? [{ act: e.acts }]
          : e.type === "done"
            ? [{ done: e.text }]
            : [],
  );
  const prompt = JSON.stringify({
    heSaid: c.said,
    pointedAt: c.context.pointedWhileSaying,
    expected: c.expect,
    agentDid: did,
  });
  for await (const m of query({
    prompt,
    options: {
      model: "claude-opus-5-5",
      thinking: { type: "disabled" },
      tools: [],
      settingSources: [],
      systemPrompt: JUDGE,
      persistSession: false,
    },
  }))
    if (m.type === "result" && m.subtype === "success") {
      const json = /\{[\s\S]*\}/.exec(m.result)?.[0] ?? "{}";
      return JSON.parse(json) as { right?: boolean; why?: string };
    }
  return {};
}

/** The selectors the agent used that are not among the page's elements. */
function strays(events: readonly AgentEvent[], body: string | null) {
  const known = new Set(
    ((JSON.parse(body ?? "{}") as { elements?: { selector: string }[] }).elements ?? []).map(
      (e) => e.selector,
    ),
  );
  const used = events.flatMap((e) => [
    ...(e.target === undefined ? [] : [e.target]),
    ...(e.beats ?? []).map((b) => b.target),
  ]);
  return used.filter((t) => !known.has(t));
}

const all = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8")) as Case[];
const only = args.only?.split(",");
const cases = only === undefined ? all : all.filter((c) => only.includes(c.id));

/** The case's audio as wav, and how long it is, in s. */
function audioOf(id: string) {
  const webm = join(HERE, "audio", `${id}.webm`);
  if (!existsSync(webm)) return undefined;
  const wav = join(HERE, "audio", `${id}.wav`);
  if (!existsSync(wav))
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", webm, "-ar", "48000", wav]);
  const probe = ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav];
  return { wav, seconds: Number(execFileSync("ffprobe", probe).toString()) };
}

const rows: string[] = [];
const acts: number[] = [];
const voices: number[] = [];
const steps = new Map<string, number[]>();
const firsts = new Map<string, number>();
const verdicts: boolean[] = [];
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  for (const c of cases) {
    const audio = audioOf(c.id);
    if (audio === undefined) {
      console.warn(`${c.id}: no audio; run evals/hearing.ts first`);
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(
      ({ wav, pause }: { wav: string; pause: number }) => {
        const bytes = Uint8Array.from(atob(wav), (ch) => ch.charCodeAt(0));
        const media = navigator.mediaDevices;
        media.getUserMedia = async () => {
          const context = new AudioContext();
          const buffer = await context.decodeAudioData(bytes.buffer.slice(0));
          const source = context.createBufferSource();
          source.buffer = buffer;
          const out = context.createMediaStreamDestination();
          source.connect(out);
          source.start(context.currentTime + pause);
          return out.stream;
        };
        media.enumerateDevices = async () => [];
        // A copy of what the page sends the agent and what it streams back, for the checks.
        const seen = { body: "", text: "", ended: false };
        Object.assign(window, { __agent: seen });
        const send = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await send(input, init);
          if (input !== "/__agent" || response.body === null) return response;
          seen.body = typeof init?.body === "string" ? init.body : "";
          seen.text = "";
          seen.ended = false;
          const [mine, theirs] = response.body.tee();
          void (async () => {
            const reader = mine.pipeThrough(new TextDecoderStream()).getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              seen.text += value;
            }
            seen.ended = true;
          })();
          return new Response(theirs, response);
        };
      },
      { wav: readFileSync(audio.wav).toString("base64"), pause: PAUSE },
    );
    try {
      await page.goto(`${args.url}/workshop.html#queue`);
      const target = page.locator(c.context.pointedWhileSaying[0]?.target ?? "body").first();
      await target.waitFor();
      // Let the page fetch its first token, as it does before he speaks.
      await page.waitForTimeout(1000);
      const trace = page.evaluate(
        () =>
          new Promise<Trace>((done) =>
            addEventListener("blueline:trace", (e) => done((e as CustomEvent<Trace>).detail), {
              once: true,
            }),
          ),
      );
      // A new agent session for each case.
      await fetch(`${args.url}/__agent/forget`, { method: "POST" });
      await target.hover();
      await page.keyboard.down("Control");
      await page.keyboard.down("Meta");
      await page.waitForTimeout((audio.seconds + PAUSE) * 1000 + 150);
      await page.keyboard.up("Meta");
      await page.keyboard.up("Control");
      const t = await Promise.race([
        trace,
        new Promise<undefined>((done) => setTimeout(() => done(undefined), 40_000)),
      ]);
      if (t === undefined) {
        rows.push(`| ${c.id} | - | - | - | - | no trace | - |`);
        continue;
      }
      const m = t.marks;
      const after = (mark: string) =>
        m[mark] === undefined || m["release"] === undefined
          ? "-"
          : String((m[mark] ?? 0) - (m["release"] ?? 0));
      if (m["agent"] !== undefined && m["release"] !== undefined)
        acts.push(m["agent"] - m["release"]);
      if (m["voice"] !== undefined && m["release"] !== undefined)
        voices.push(m["voice"] - m["release"]);
      // The page's steps from the act to the voice.
      for (const [name, from, to] of [
        ["walk comes to the first line", "agent", "say"],
        ["voice starts to play", "say", "voice"],
        ["act to voice", "agent", "voice"],
      ] as const) {
        const a = m[from];
        const b = m[to];
        if (a !== undefined && b !== undefined)
          steps.set(name, [...(steps.get(name) ?? []), b - a]);
      }
      const server = t.server?.marks ?? {};
      for (const [name, from, to] of STEPS) {
        const a = from === "" ? 0 : server[from];
        const b = server[to];
        if (a !== undefined && b !== undefined)
          steps.set(name, [...(steps.get(name) ?? []), b - a]);
      }
      const ahead = t.server?.blocks.slice(
        0,
        t.server.blocks.findIndex((b) => b.startsWith("mcp__page__")),
      );
      const first = (ahead ?? []).join(" ") || "none";
      firsts.set(first, (firsts.get(first) ?? 0) + 1);
      // The agent's work: the stream ends when it is done.
      await page
        .waitForFunction(
          () => (window as unknown as { __agent: { ended: boolean } }).__agent.ended,
          {
            timeout: 90_000,
          },
        )
        .catch(() => undefined);
      const got = await page.evaluate(
        () => (window as unknown as { __agent: { body: string; text: string } }).__agent,
      );
      const events = (got?.text ?? "")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as AgentEvent);
      const lost = strays(events, got?.body ?? null);
      const verdict = args["no-judge"] ? {} : await judge(c, events);
      const right = verdict.right === true && lost.length === 0;
      if (!args["no-judge"]) verdicts.push(right);
      const work = events
        .filter((e) => ["show", "annotate", "act"].includes(e.type))
        .map((e) => e.type)
        .join(" ");
      const why =
        lost.length > 0 ? `not on the page: ${lost.join(", ")}` : (verdict.why ?? "not judged");
      rows.push(
        `| ${c.id} | ${String(m["mic"] ?? "-")} | ${after("words")} | ${after("painted")} | ${after("agent")} | ${t.said ?? ""} → ${t.line ?? ""} | ${args["no-judge"] ? "" : right ? "right" : "WRONG"} ${work}: ${why} |`,
      );
      console.log(rows.at(-1));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(
  "\n| case | mic opens | words after release | line on screen | agent acts | heard → line | agent's work |",
);
console.log("|---|---|---|---|---|---|---|");
for (const row of rows) console.log(row);
const pct = (xs: readonly number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
if (steps.size > 0) {
  console.log("\n| agent step | p50 ms | p90 ms |");
  console.log("|---|---|---|");
  for (const [name, xs] of steps)
    console.log(`| ${name} | ${String(pct(xs, 50))} | ${String(pct(xs, 90))} |`);
  console.log(
    `\nBlocks before the first page tool: ${[...firsts].map(([b, n]) => `${b} ${String(n)}`).join(", ")}`,
  );
}
if (voices.length > 0)
  console.log(
    `Voice plays after release: p50 ${String(pct(voices, 50))} ms, p90 ${String(pct(voices, 90))} ms`,
  );
if (acts.length > 0)
  console.log(
    `\nAgent acts after release: p50 ${String(pct(acts, 50))} ms, p90 ${String(pct(acts, 90))} ms`,
  );
if (verdicts.length > 0)
  console.log(
    `Agent right: ${String(verdicts.filter(Boolean).length)} of ${String(verdicts.length)}`,
  );
