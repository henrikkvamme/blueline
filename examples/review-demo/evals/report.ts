/*
 * Where the time goes in real use: sums the workshop's traces (evals/hearing/live.jsonl),
 * one per exchange, into the time of each step, from the keys to the first line on screen.
 *
 *   node examples/review-demo/evals/report.ts [--last 50]
 *
 * See src/workshop/queue/timing.ts for the marks.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const LIVE = join(fileURLToPath(new URL("../../..", import.meta.url)), "evals/hearing/live.jsonl");

type Marks = Partial<Record<string, number>>;
interface Trace {
  readonly typed: boolean;
  readonly marks: Marks;
  readonly ear?: string;
}

const { values: args } = parseArgs({ options: { last: { type: "string", default: "50" } } });

/** Each step: its name, and the marks it goes from and to. */
const STEPS = [
  ["microphone opens", "press", "mic"],
  ["he speaks", "mic", "release"],
  ["speech to text", "release", "words"],
  ["page asks", "words", "sent"],
  ["fast line, first word", "sent", "heard"],
  ["on screen", "heard", "painted"],
  ["after release: line", "release", "painted"],
  ["after release: agent acts", "release", "agent"],
  ["typed: line", "sent", "painted"],
] as const;

const pct = (xs: readonly number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

if (!existsSync(LIVE)) {
  console.log("No traces yet: talk to the queue workshop's agent first.");
  process.exit(0);
}
const traces = readFileSync(LIVE, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Trace)
  .slice(-Number(args.last));

console.log(`${String(traces.length)} exchanges\n`);
console.log("| step | n | p50 ms | p90 ms |");
console.log("|---|---|---|---|");
for (const [name, from, to] of STEPS) {
  const xs = traces.flatMap((t) => {
    if (name.startsWith("typed") !== t.typed) return [];
    const a = t.marks[from];
    const b = t.marks[to];
    return a === undefined || b === undefined ? [] : [b - a];
  });
  if (xs.length === 0) continue;
  console.log(
    `| ${name} | ${String(xs.length)} | ${String(pct(xs, 50))} | ${String(pct(xs, 90))} |`,
  );
}
const ears = new Map<string, number>();
for (const t of traces) if (t.ear !== undefined) ears.set(t.ear, (ears.get(t.ear) ?? 0) + 1);
if (ears.size > 0)
  console.log(`\nWho heard: ${[...ears].map(([e, n]) => `${e} ${String(n)}`).join(", ")}`);
