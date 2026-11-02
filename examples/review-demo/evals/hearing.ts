/*
 * The hearing evals: how fast and how right the first answer is, from the moment he lets go
 * of the keys to the first word of the line, without a browser.
 *
 *   node examples/review-demo/evals/hearing.ts [--stt batch,realtime] [--hear terra,haiku]
 *                             [--repeat 2] [--only id,id] [--no-judge]
 *
 * The cases are evals/hearing/cases.json (made-up remarks on the demo's request page, spoken by ElevenLabs)
 * and each take he saved in the workshop (evals/hearing/takes/<id>/, his own voice). For each case it runs
 * each speech-to-text and each way to hear:
 * - stt: ms from the end of his audio to the final words. Realtime streams the audio at the
 *   pace he spoke it, so only the wait after the last chunk counts.
 * - hear: ms from the words to the first word of the line, and to the whole line.
 * - right: Claude Opus 5.5 judges whether the line says what he asked for.
 * The run goes to evals/hearing/runs/<time>.json, and a table to the terminal.
 *
 * It needs ELEVENLABS_API_KEY with text-to-speech and speech-to-text, Codex signed in, and
 * Claude Code signed in.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { keytermsOf } from "../../../src/workshop/queue/ears.ts";
import { ears, type Ear } from "../hearing.ts";

/** The texts on the page, which the realtime ears get as keyterms, as the page sends them. */
const pageTexts = (c: { readonly context: Record<string, unknown> }) =>
  ((c.context["elements"] ?? []) as readonly { where?: string; text?: string }[]).flatMap((e) =>
    e.where === "page" && e.text !== undefined ? [e.text] : [],
  );

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const HERE = join(ROOT, "evals", "hearing");
const VOICE = "JBFqnCBsd6RMkjVDRZzb";

interface Case {
  readonly id: string;
  readonly said: string;
  readonly expect?: { readonly kind: "question" | "change"; readonly gist: string };
  readonly context: Record<string, unknown>;
  /** His audio, as webm. */
  audio?: string;
  readonly take?: boolean;
}

interface Result {
  readonly case: string;
  readonly stt: string;
  readonly hear: string;
  readonly round: number;
  readonly sttMs: number | undefined;
  readonly words: string | undefined;
  readonly firstMs: number | undefined;
  readonly lineMs: number | undefined;
  readonly line: string | undefined;
  readonly ear: Ear | undefined;
  right?: boolean | undefined;
  why?: string | undefined;
}

const { values: args } = parseArgs({
  options: {
    stt: { type: "string", default: "batch,realtime" },
    hear: { type: "string", default: "terra,haiku" },
    repeat: { type: "string", default: "2" },
    only: { type: "string" },
    "no-judge": { type: "boolean", default: false },
  },
});

const key = process.env["ELEVENLABS_API_KEY"] ?? "";
if (key === "") throw new Error("Set ELEVENLABS_API_KEY, with text-to-speech and speech-to-text.");

/** The made-up cases, with their audio spoken once and kept, and his saved takes. */
async function cases(): Promise<Case[]> {
  const made = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8")) as Case[];
  mkdirSync(join(HERE, "audio"), { recursive: true });
  for (const c of made) {
    const file = join(HERE, "audio", `${c.id}.webm`);
    if (!existsSync(file)) {
      const r = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({ text: c.said, model_id: "eleven_v4" }),
        },
      );
      if (!r.ok) throw new Error(`Text to speech ${String(r.status)}: ${await r.text()}`);
      const mp3 = `${file}.mp3`;
      writeFileSync(mp3, new Uint8Array(await r.arrayBuffer()));
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", mp3, "-c:a", "libopus", file]);
    }
    c.audio = file;
  }
  const takesDir = join(HERE, "takes");
  const taken = existsSync(takesDir)
    ? readdirSync(takesDir).flatMap((id): Case[] => {
        const dir = join(takesDir, id);
        if (!existsSync(join(dir, "take.json"))) return [];
        const take = JSON.parse(readFileSync(join(dir, "take.json"), "utf8")) as {
          trace: { said?: string };
          context?: Record<string, unknown>;
        };
        if (take.context === undefined) return [];
        return [
          {
            id: `take-${id.slice(0, 8)}`,
            said:
              take.trace.said ??
              (typeof take.context["said"] === "string" ? take.context["said"] : ""),
            context: take.context,
            ...(existsSync(join(dir, "audio.webm")) ? { audio: join(dir, "audio.webm") } : {}),
            take: true,
          },
        ];
      })
    : [];
  const all = [...made, ...taken];
  const only = args.only?.split(",");
  return only === undefined ? all : all.filter((c) => only.includes(c.id));
}

/** Batch: the whole audio up, the words back. */
async function batch(audio: string) {
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([readFileSync(audio)], { type: "audio/webm" }), "words.webm");
  const at = performance.now();
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!r.ok) throw new Error(`Speech to text ${String(r.status)}: ${await r.text()}`);
  const { text } = (await r.json()) as { text: string };
  return { ms: performance.now() - at, text: text.trim() };
}

/** Realtime: the audio streams as he speaks it; the wait counts from the last chunk. */
async function realtime(audio: string, keyterms: readonly string[]) {
  const pcm = execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-i",
    audio,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-f",
    "s16le",
    "-",
  ]);
  const url =
    "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime" +
    "&commit_strategy=manual&audio_format=pcm_16000" +
    keyterms.map((k) => `&keyterms=${encodeURIComponent(k)}`).join("");
  const ws = new WebSocket(url, { headers: { "xi-api-key": key } } as never);
  return new Promise<{ ms: number; text: string }>((done, fail) => {
    let last = 0;
    const timer = setTimeout(() => fail(new Error("Realtime gave no words")), 30_000);
    ws.onmessage = async (e) => {
      const m = JSON.parse(String(e.data)) as { message_type: string; text?: string };
      if (m.message_type === "session_started") {
        const step = 3200; // 100 ms of audio
        for (let i = 0; i < pcm.length; i += step) {
          const end = i + step >= pcm.length;
          ws.send(
            JSON.stringify({
              message_type: "input_audio_chunk",
              audio_base_64: pcm.subarray(i, i + step).toString("base64"),
              commit: end,
              sample_rate: 16000,
            }),
          );
          if (end) last = performance.now();
          else await new Promise((r) => setTimeout(r, 100));
        }
      } else if (m.message_type.startsWith("committed_transcript")) {
        clearTimeout(timer);
        ws.close();
        done({ ms: performance.now() - last, text: (m.text ?? "").trim() });
      } else if (m.message_type.includes("error")) {
        clearTimeout(timer);
        ws.close();
        fail(new Error(JSON.stringify(m)));
      }
    };
    ws.onerror = () => fail(new Error("Realtime socket failed"));
  });
}

const JUDGE = `You check a voice tool's one-line readback. A reviewer pointed at a web page and spoke; a fast model said back in one line what he asked for, so he can catch a wrong hearing. Judge only whether the line says what he asked for: the same kind (a question stays a question, a change stays a change), the same thing on the page, and nothing he did not ask. Small wording does not matter; a line that answers the question instead of restating it is wrong; a line over 15 words is wrong. Reply with JSON only: {"right": true|false, "why": "at most 12 words"}.`;

async function judge(c: Case, line: string) {
  const prompt = JSON.stringify({
    heSaid: c.said,
    pointedAt: c.context["pointedWhileSaying"],
    expected: c.expect,
    line,
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

const pct = (xs: readonly number[], p: number) => {
  if (xs.length === 0) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const ms = (n: number | undefined) => (n === undefined ? "-" : String(Math.round(n)));

async function main() {
  const all = await cases();
  const stts = args.stt.split(",");
  const hears = args.hear.split(",");
  const repeat = Number(args.repeat);
  console.log(
    `${String(all.length)} cases, stt ${stts.join(" ")}, hear ${hears.join(" ")}, ${String(repeat)} rounds`,
  );
  const results: Result[] = [];
  for (const how of hears) {
    const hearing = ears({ use: how === "haiku" ? "haiku" : "terra" });
    hearing.ready();
    // Let the warm thread or process start, as the dev server does before he speaks.
    await new Promise((r) => setTimeout(r, 8000));
    for (let round = 0; round < repeat; round++)
      for (const c of all)
        for (const stt of stts) {
          let sttMs: number | undefined;
          let words: string | undefined = c.said;
          if (c.audio !== undefined) {
            try {
              const got =
                stt === "realtime"
                  ? await realtime(c.audio, keytermsOf(pageTexts(c)))
                  : await batch(c.audio);
              sttMs = got.ms;
              words = got.text;
            } catch (error) {
              console.warn(`${c.id} ${stt}: ${String(error)}`);
            }
          }
          const text = JSON.stringify({ ...c.context, said: words });
          const at = performance.now();
          let firstMs: number | undefined;
          let line: string | undefined;
          let ear: Ear | undefined;
          try {
            await hearing.hear(text, new AbortController().signal, (l, e) => {
              firstMs ??= performance.now() - at;
              line = l;
              ear = e;
            });
          } catch (error) {
            console.warn(`${c.id} ${how}: ${String(error)}`);
          }
          const result: Result = {
            case: c.id,
            stt,
            hear: how,
            round,
            sttMs,
            words,
            firstMs,
            lineMs: line === undefined ? undefined : performance.now() - at,
            line,
            ear,
          };
          results.push(result);
          console.log(
            `${how.padEnd(11)} ${stt.padEnd(8)} ${c.id.padEnd(18)} stt ${ms(sttMs).padStart(4)}  first ${ms(firstMs).padStart(5)}  ${ear ?? ""} | ${line ?? "(nothing)"}`,
          );
        }
    hearing.close();
  }
  if (!args["no-judge"]) {
    // The judge sees each distinct line once.
    const verdicts = new Map<string, Promise<{ right?: boolean; why?: string }>>();
    const byId = new Map(all.map((c) => [c.id, c]));
    await Promise.all(
      results.map(async (r) => {
        const c = byId.get(r.case);
        if (c === undefined || r.line === undefined) return;
        const k = `${r.case}\n${r.line}`;
        if (!verdicts.has(k)) verdicts.set(k, judge(c, r.line));
        const v = await verdicts.get(k);
        r.right = v?.right;
        r.why = v?.why;
      }),
    );
  }
  mkdirSync(join(HERE, "runs"), { recursive: true });
  const file = join(HERE, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify({ args, results }, null, 1)}\n`);

  console.log(
    "\n| hear | stt | stt p50 | stt p90 | first word p50 | p90 | after release p50 | p90 | right |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const how of hears)
    for (const stt of stts) {
      const rs = results.filter((r) => r.hear === how && r.stt === stt);
      const stt_ = rs.flatMap((r) => (r.sttMs === undefined ? [] : [r.sttMs]));
      const first = rs.flatMap((r) => (r.firstMs === undefined ? [] : [r.firstMs]));
      const total = rs.flatMap((r) =>
        r.firstMs === undefined ? [] : [(r.sttMs ?? 0) + r.firstMs],
      );
      const judged = rs.filter((r) => r.right !== undefined);
      const right =
        judged.length === 0
          ? "-"
          : `${String(Math.round((100 * judged.filter((r) => r.right).length) / judged.length))}%`;
      console.log(
        `| ${how} | ${stt} | ${ms(pct(stt_, 50))} | ${ms(pct(stt_, 90))} | ${ms(pct(first, 50))} | ${ms(pct(first, 90))} | ${ms(pct(total, 50))} | ${ms(pct(total, 90))} | ${right} |`,
      );
    }
  const wrong = results.filter((r) => r.right === false);
  if (wrong.length > 0) {
    console.log("\nWrong lines:");
    for (const r of wrong)
      console.log(`- ${r.case} (${r.hear}, ${r.stt}): "${r.line ?? ""}" (${r.why ?? ""})`);
  }
  console.log(`\nSaved ${file}`);
}

await main();
