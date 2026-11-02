/*
 * The hearing evals in a real browser: the whole way from the keys to the line on screen,
 * through the dev server, as Henrik uses it. For each case, the page's microphone plays the
 * case's audio in real time, from a moment after the page opens it. (Chromium's own fake
 * microphone never opens on fry, so getUserMedia is replaced with a Web Audio stream.) The
 * eval points at the case's element, holds Control and Command while the audio plays, lets
 * go, and takes the page's trace (src/workshop/queue/timing.ts).
 *
 *   node examples/review-demo/evals/browser.ts [--url http://localhost:4314] [--only id,id]
 *
 * The dev server must run with ELEVENLABS_API_KEY, and the audio must exist: run
 * evals/hearing.ts once first, which speaks each case.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const HERE = join(ROOT, "evals", "hearing");
/** He starts to speak this long after the microphone opens, in s. */
const PAUSE = 0.3;

interface Case {
  readonly id: string;
  readonly said: string;
  readonly context: { readonly pointedWhileSaying: readonly { readonly target: string }[] };
}
interface Trace {
  readonly marks: Partial<Record<string, number>>;
  readonly said?: string;
  readonly line?: string;
  readonly ear?: string;
}

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:4314" },
    only: { type: "string" },
  },
});

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
        rows.push(`| ${c.id} | - | - | - | - | no trace |`);
        continue;
      }
      const m = t.marks;
      const after = (mark: string) =>
        m[mark] === undefined || m["release"] === undefined
          ? "-"
          : String((m[mark] ?? 0) - (m["release"] ?? 0));
      rows.push(
        `| ${c.id} | ${String(m["mic"] ?? "-")} | ${after("words")} | ${after("painted")} | ${after("agent")} | ${t.said ?? ""} → ${t.line ?? ""} |`,
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
  "\n| case | mic opens | words after release | line on screen | agent acts | heard → line |",
);
console.log("|---|---|---|---|---|---|");
for (const row of rows) console.log(row);
