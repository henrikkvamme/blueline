/// <reference lib="dom" />
/*
 * The answer evals: Henrik's requests to the workshop agent, played end to end in the real
 * page as he makes them. For each case a browser opens the workshop on a dev server that runs
 * the version under test, from its own checkout. Each turn of the case is spoken (its speech
 * plays as the page's microphone while the eval holds ⌃⌘), circled (a loop drawn round a part
 * while he speaks) or typed (⌃⌃). The eval points at parts on the words he says about them,
 * plays his part when a walk waits for his click, and keeps the page before, each mock-up and
 * the page at the end.
 *
 * Code checks only what has one right answer: no code edits, a mock-up or none, the agent's
 * own clicks or none, and the queue or page after an act. Two judges of different families
 * decide the rest (judge.ts). A case passes when the code checks pass and both judges say yes
 * to every claim.
 *
 *   node evals/answers/run.ts --variant v1 --url http://127.0.0.1:4315 --tree <checkout>
 *     [--set dev|held|all] [--only id,id] [--reps 1] [--judges opus,sol]
 *   node evals/answers/run.ts --variant v1 --rejudge --judges sonnet,haiku   (saved runs)
 *
 * A new line of speech needs ELEVENLABS_API_KEY once; it is kept under evals/answers/audio/.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { CLAIMS, judge, passes, type Picture, type Verdict } from "./judge.ts";
import { speak, type Speech } from "./speech.ts";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "../..");
const SDK = path.join(
  REPO,
  "examples/review-demo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
);

const { values: flags } = parseArgs({
  options: {
    variant: { type: "string", default: "baseline" },
    reps: { type: "string", default: "1" },
    only: { type: "string" },
    set: { type: "string", default: "dev" },
    url: { type: "string", default: "http://127.0.0.1:4313" },
    tree: { type: "string", default: REPO },
    "timeout-s": { type: "string", default: "240" },
    judges: { type: "string", default: "opus,sol" },
    rejudge: { type: "boolean", default: false },
    regrade: { type: "boolean", default: false },
    shard: { type: "string", default: "1/1" },
    list: { type: "boolean", default: false },
  },
});

const VARIANT = flags.variant;
if (!/^(baseline|v\d+)$/.test(VARIANT))
  throw new Error(`A variant is baseline or v<N>, not ${VARIANT}`);
const RUNS = path.join(HERE, "runs");
const OUT = path.join(RUNS, VARIANT);
const AUDIO = path.join(HERE, "audio");
const TIMEOUT = Number(flags["timeout-s"]) * 1000;
const JUDGES = flags.judges.split(",").filter(Boolean);
/** The app's part of the window; the workshop's panel is to its right. */
const VIEW = { width: 1512, height: 900 };
const APP = { width: VIEW.width - 360, height: VIEW.height };

/** One thing he does: says, loops round or types a request. */
interface Turn {
  readonly said: string;
  readonly input: "spoken" | "circled" | "typed";
  /** Where his mouse is: the first part before he speaks, then each part from its word on. */
  readonly point?: readonly { readonly target: string; readonly word?: number }[];
  /** The part he draws a loop round, from the word he says as he starts it. */
  readonly circle?: { readonly target: string; readonly word?: number };
  /** When he speaks: once the answer before is over, or as soon as it shows its first beat. */
  readonly when?: "after" | "first-beat";
}

interface Case {
  readonly id: string;
  readonly group: string;
  /** dev cases tune the agent; held cases only measure it. */
  readonly set: "dev" | "held";
  readonly source: string;
  readonly page: string;
  /** The remark that shows when he starts, by its title. */
  readonly remark?: string;
  readonly turns: readonly Turn[];
  readonly expect: {
    readonly mockup: "none" | "some" | "any";
    /** The part a mock-up must be on, when only one part is right. */
    readonly target?: string;
    /** Whether the agent may change code: only for a change to the workshop itself. */
    readonly edits?: "none" | "any";
    /** Whether the agent clicks itself (a journey it runs) or waits for his clicks. */
    readonly clicks?: "none" | "some" | "any";
    /** Checks of the queue (q, and start before he spoke) or the page (doc) at the end. */
    readonly checks?: readonly { readonly says: string; readonly js: string }[];
    /** For the judges: what a good answer could do, and what would be wrong. */
    readonly guide: string;
  };
}

interface Answer {
  readonly body: Record<string, unknown>;
  readonly sent: number;
  readonly events: readonly { readonly at: number; readonly e: Record<string, unknown> }[];
  readonly done: boolean;
  readonly ended?: number;
}

interface Shot {
  readonly key: string;
  readonly file: string;
  readonly before: string;
  readonly clip: Clip;
  readonly text: string;
  readonly at: number;
}

interface Clip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Gesture {
  readonly t: number;
  readonly did: string;
}

const cases: readonly Case[] = JSON.parse(readFileSync(path.join(HERE, "cases.json"), "utf8"));

const facts = () => `Today is ${new Date().toISOString().slice(0, 10)}.
The made-up app is a bonus request with three pages, behind tabs: Request, Approvers and Sent.
- Request: the title "Bonus for Kari Nordmann"; under it "Asked by Ola Hansen · 2 days ago" (the app stores no date, only that line); a status pill "In review" with a blue dot (the app's looks: blue while it moves, green when approved, red when sent back); the field Amount, read-only, "NOK 40 000"; Approvers: Ola Hansen, Director, then Ingrid Berg, Finance, in grey rows, in that order; the button "Send for approval", which goes to Sent.
- Ola Hansen asked for the bonus and is also the first approver. Kari Nordmann gets the bonus.
- Approvers: the same two rows with drag handles, and "Add an approver", which adds Kari Nordmann, HR.
- Sent: "Sent for approval", and a grey line that ends "Ingrid Berg gets it once Ola Hansen approves." The app stores no send time.
- The app has no exchange rates. A real rate in late 2026 is about 10.5 to 12.5 NOK to the euro and 9.5 to 11.5 NOK to the US dollar; a figure in that range, rounded, is right.
The workshop: a review queue of remarks about the app, in a panel on the right. He can go next and back, settle a remark, undo, open the tree of remarks, keep a variant, and ask the agent. The agent may change the workshop's own code only when he asks for a change to the workshop; a change to the made-up app is mocked up or put in the queue, never made in code.`;

const INIT = `
localStorage.setItem("blueline.workshop.queue.guide", JSON.stringify({ on: false, voice: false, reduced: true }));
window.__answers = [];
window.__textOf = (el) => [el.innerText, ...[...el.querySelectorAll("input, textarea")].map((i) => i.value)].join(" ").replace(/\\s+/g, " ").trim();
const plain = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (!/\\/__agent$/.test(url)) return plain(input, init);
  let body = {};
  try { body = JSON.parse(String(init?.body ?? "{}")); } catch {}
  const answer = { body, sent: performance.now(), events: [], done: false };
  window.__answers.push(answer);
  const res = await plain(input, init);
  if (res.body === null) { answer.done = true; return res; }
  const [mine, theirs] = res.body.tee();
  (async () => {
    const reader = theirs.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.trim() !== "") answer.events.push({ at: performance.now(), e: JSON.parse(line) });
      }
    }
    answer.done = true;
    answer.ended = performance.now();
  })();
  return new Response(mine, { headers: res.headers, status: res.status });
};
// The microphone: one live stream that stays open, as a real one does; each line of speech
// plays into it when the eval says so, and silence the rest of the time.
const ears = new AudioContext();
const into = ears.createMediaStreamDestination();
const hush = ears.createConstantSource();
hush.offset.value = 0;
hush.connect(into);
hush.start();
const media = navigator.mediaDevices;
media.getUserMedia = async () => {
  if (ears.state !== "running") await ears.resume();
  return new MediaStream(into.stream.getAudioTracks().map((t) => t.clone()));
};
media.enumerateDevices = async () => [];
window.__speak = async (b64) => {
  if (ears.state !== "running") await ears.resume();
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const buffer = await ears.decodeAudioData(bytes.buffer);
  const source = ears.createBufferSource();
  source.buffer = buffer;
  source.connect(into);
  window.__spoken = new Promise((done) => (source.onended = () => done(performance.now())));
  const lead = 0.05;
  source.start(ears.currentTime + lead);
  return performance.now() + lead * 1000;
};
`;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const quote = (target: string) => `[data-q="${target}"]`;

async function aim(page: Page, target: string) {
  const el = page.locator(quote(target)).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (box === null) throw new Error(`No box for ${target}`);
  const at = await page.evaluate(
    ({ target, box }) => {
      for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85])
        for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
          const x = box.x + box.width * fx;
          const y = box.y + box.height * fy;
          const hit = document.elementFromPoint(x, y)?.closest("[data-q]");
          if (hit?.getAttribute("data-q") === target) return { x, y };
        }
      return undefined;
    },
    { target, box },
  );
  if (at === undefined) throw new Error(`No point on ${target} is its own`);
  return { box, at };
}

const clipAround = (boxes: readonly Clip[]): Clip => {
  const pad = 56;
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(APP.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(APP.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
};

/** The same area of the page before he spoke, cut from the picture taken then. */
function cut(from: string, clip: Clip, to: string) {
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-i",
    from,
    "-vf",
    `crop=${String(clip.width)}:${String(clip.height)}:${String(clip.x)}:${String(clip.y)}`,
    to,
  ]);
}

/** A hand-drawn loop round a box: a wobbly ellipse, a little wider than the box. */
function loopRound(box: Clip) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2 + 18;
  const ry = box.height / 2 + 14;
  return Array.from({ length: 34 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 30) * Math.PI * 2;
    const wobble = 1 + 0.04 * Math.sin(i * 1.7);
    return {
      x: Math.min(APP.width - 4, Math.max(4, cx + rx * wobble * Math.cos(a))),
      y: Math.min(APP.height - 4, Math.max(4, cy + ry * wobble * Math.sin(a))),
    };
  });
}

const git = (tree: string, ...args: string[]) =>
  execFileSync("git", ["-C", tree, ...args], { encoding: "utf8" });

const answersOf = (page: Page) => page.evaluate(() => Reflect.get(window, "__answers") as Answer[]);

/** He says, loops round or types one request. Gives back what he did, in time. */
async function perform(page: Page, turn: Turn): Promise<{ gestures: Gesture[]; end: number }> {
  const gestures: Gesture[] = [];
  const first = turn.point?.[0]?.target ?? turn.circle?.target;
  if (first !== undefined) {
    const { at } = await aim(page, first);
    await page.mouse.move(at.x, at.y, { steps: 8 });
    gestures.push({ t: 0, did: `mouse on ${first}` });
  }
  if (turn.input === "typed") {
    await page.keyboard.press("Control");
    await sleep(90);
    await page.keyboard.press("Control");
    await page.waitForSelector("input[aria-label], textarea", { timeout: 5000 });
    await page.keyboard.type(turn.said, { delay: 20 });
    await page.keyboard.press("Enter");
    const end = await page.evaluate(() => performance.now());
    return { gestures: [...gestures, { t: 0, did: `typed "${turn.said}"` }], end };
  }
  const speech: Speech = await speak(AUDIO, turn.said);
  await page.keyboard.down("Control");
  await page.keyboard.down("Meta");
  // A person starts to speak a moment after the keys go down.
  await sleep(300);
  const pageStart = await page.evaluate(
    (b64) => (Reflect.get(window, "__speak") as (b: string) => Promise<number>)(b64),
    speech.audio,
  );
  const pageNow = await page.evaluate(() => performance.now());
  const t0 = Date.now() + (pageStart - pageNow);
  const at = (word: number | undefined) => speech.words[word ?? 0]?.start ?? 0;
  const plan: { t: number; run: () => Promise<void> }[] = [];
  for (const step of (turn.point ?? []).slice(1))
    plan.push({
      t: Math.max(0, at(step.word) - 0.15),
      run: async () => {
        const { at: p } = await aim(page, step.target);
        await page.mouse.move(p.x, p.y, { steps: 10 });
        gestures.push({
          t: (Date.now() - t0) / 1000,
          did: `mouse on ${step.target}, at "${speech.words[step.word ?? 0]?.word ?? ""}"`,
        });
      },
    });
  const circle = turn.circle;
  if (circle !== undefined)
    plan.push({
      t: at(circle.word),
      run: async () => {
        const { box } = await aim(page, circle.target);
        const points = loopRound(box);
        const from = (Date.now() - t0) / 1000;
        for (const p of points) {
          await page.mouse.move(p.x, p.y, { steps: 2 });
          await sleep(22);
        }
        gestures.push({
          t: from,
          did: `drew a loop round ${circle.target}, from "${speech.words[circle.word ?? 0]?.word ?? ""}", until ${((Date.now() - t0) / 1000).toFixed(1)} s`,
        });
      },
    });
  plan.sort((a, b) => a.t - b.t);
  for (const step of plan) {
    const wait = t0 + step.t * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    await step.run();
  }
  await page.evaluate(() => Reflect.get(window, "__spoken") as Promise<number>);
  await sleep(250);
  await page.keyboard.up("Meta");
  await page.keyboard.up("Control");
  const end = await page.evaluate(() => performance.now());
  return {
    gestures: [
      { t: 0, did: `held ⌃⌘ and said "${turn.said}" (${speech.seconds.toFixed(1)} s)` },
      ...gestures,
    ],
    end,
  };
}

interface Run {
  readonly shots: Shot[];
  readonly turns: { readonly turn: Turn; readonly gestures: Gesture[]; readonly end: number }[];
  readonly answers: Answer[];
  readonly hisClicks: string[];
  readonly before: string;
  readonly end: string;
  readonly checks: { says: string; ok: boolean }[];
  readonly edited: string;
  readonly timedOut: boolean;
  readonly beforeQueue: unknown;
}

async function runCase(browser: Browser, c: Case, rep: number, url: string, tree: string) {
  const dir = path.join(OUT, "shots", `${c.id}_rep${String(rep)}`);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: VIEW, reducedMotion: "reduce" });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const started = Date.now();
  const shots: Shot[] = [];
  const turns: Run["turns"] = [];
  const hisClicks: string[] = [];
  let timedOut = false;
  try {
    await fetch(`${url}/__agent/forget`, { method: "POST" });
    await page.goto(`${url}/workshop.html#queue`);
    await page.waitForSelector('aside[aria-label="Blueline"]');
    if (c.page !== "/request") await page.click(quote(`tab-${c.page.slice(1)}`));
    if (c.remark !== undefined) {
      await page.keyboard.press("t");
      await page.getByText(c.remark).first().click();
      await sleep(400);
    }
    await page.mouse.move(APP.width / 2, 40);
    await sleep(400);
    const before = path.join(dir, "before.png");
    await page.screenshot({ path: before, clip: { x: 0, y: 0, ...APP } });
    const beforeQueue = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("blueline.workshop.queue.4") ?? "null"),
    );
    const seen = new Set<string>();
    const watch = async (until: () => Promise<boolean>) => {
      const deadline = started + TIMEOUT;
      let quiet = 0;
      while (Date.now() < deadline) {
        const state = await page.evaluate(() => ({
          walk: document.documentElement.dataset["walk"] ?? "idle",
          turn: document.documentElement.dataset["walkTurn"] ?? "",
          mocks: [...document.querySelectorAll<HTMLElement>("[data-mock]")].map((m) => ({
            key: m.dataset["mock"] ?? "",
            text: (Reflect.get(window, "__textOf") as (e: Element) => string)(
              document.querySelector("[data-mock-shows]") ?? m,
            ),
            box: m.getBoundingClientRect().toJSON() as Clip,
          })),
        }));
        for (const m of state.mocks) {
          if (seen.has(m.key) || shots.length >= 4) continue;
          seen.add(m.key);
          await sleep(250);
          const n = String(shots.length + 1);
          const clip = clipAround([m.box]);
          const file = path.join(dir, `mock-${n}.png`);
          await page.screenshot({ path: file, clip });
          shots.push({
            key: m.key,
            file,
            before: path.join(dir, `before-${n}.png`),
            clip,
            text: m.text,
            at: (Date.now() - started) / 1000,
          });
        }
        if (state.turn !== "") {
          const target = page.locator(state.turn).first();
          await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          if (box !== null) {
            await sleep(700);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            hisClicks.push(state.turn);
            await sleep(500);
            continue;
          }
        }
        const running = ["moving", "speaking", "turn"].includes(state.walk);
        if (!running && (await until())) {
          quiet += 1;
          if (quiet >= 4) return true;
        } else quiet = 0;
        await sleep(150);
      }
      return false;
    };
    for (const [i, turn] of c.turns.entries()) {
      if (i > 0 && turn.when !== "first-beat") {
        // He speaks again once the answer before is over.
        const ok = await watch(async () => (await answersOf(page))[i - 1]?.done === true);
        if (!ok) timedOut = true;
      }
      const did = await perform(page, turn);
      turns.push({ turn, ...did });
      const next = c.turns[i + 1];
      if (next?.when === "first-beat") {
        const ok = await watch(async () =>
          ((await answersOf(page))[i]?.events ?? []).some((x) => x.e["type"] === "show"),
        );
        if (!ok) timedOut = true;
      }
    }
    const last = c.turns.length - 1;
    if (!(await watch(async () => (await answersOf(page))[last]?.done === true))) timedOut = true;
    await sleep(500);
    const end = path.join(dir, "end.png");
    await page.screenshot({ path: end, clip: { x: 0, y: 0, ...APP } });
    for (const s of shots) cut(before, s.clip, s.before);
    const checks = await page.evaluate(
      ({ list, start }) => {
        const q = (
          JSON.parse(localStorage.getItem("blueline.workshop.queue.4") ?? "null") as {
            queue?: unknown;
          } | null
        )?.queue;
        const was = (start as { queue?: unknown } | null)?.queue;
        return list.map(({ says, js }) => {
          try {
            // oxlint-disable-next-line typescript/no-implied-eval -- the cases' own checks, from cases.json
            const ok = new Function("q", "start", "doc", `return (${js});`)(q, was, document);
            return { says, ok: ok === true };
          } catch {
            return { says, ok: false };
          }
        });
      },
      { list: c.expect.checks ?? [], start: beforeQueue },
    );
    const answers = await answersOf(page);
    const status = git(tree, "status", "--porcelain").trim();
    if (status !== "") {
      git(tree, "checkout", "--", ".");
      git(tree, "clean", "-fdq");
    }
    return {
      shots,
      turns,
      answers,
      hisClicks,
      before,
      end,
      checks,
      edited: status,
      timedOut,
      beforeQueue,
    } satisfies Run;
  } finally {
    await context.close();
  }
}

const showsOf = (answers: readonly Answer[]) =>
  answers.flatMap((a, turn) =>
    a.events.flatMap((x) =>
      x.e["type"] === "show"
        ? ((x.e["beats"] as Record<string, unknown>[] | undefined) ?? []).map((b) => ({ turn, b }))
        : [],
    ),
  );

/** What the agent did, step by step, for the judges: each beat, act and note. */
function stepsOf(answers: readonly Answer[]) {
  return answers.map((a, turn) => ({
    turn: turn + 1,
    steps: a.events.flatMap((x): Record<string, unknown>[] => {
      const e = x.e;
      if (e["type"] === "show")
        return ((e["beats"] as Record<string, unknown>[] | undefined) ?? []).map((b) => {
          const replace = b["replace"] as
            | { swap?: unknown; html?: string; text?: string }
            | undefined;
          return {
            beat: b["target"],
            said: b["say"],
            note: b["note"],
            draw: b["draw"],
            mockUp:
              replace === undefined
                ? undefined
                : replace.swap !== undefined
                  ? { swap: replace.swap }
                  : { html: (replace.html ?? replace.text ?? "").slice(0, 600) },
            waitsForHisClick: b["turn"] === true || undefined,
            clicksItself: b["click"] === true || undefined,
          };
        });
      if (e["type"] === "act") return [{ act: e["acts"] }];
      if (e["type"] === "annotate") return [{ queued: { on: e["target"], change: e["text"] } }];
      return [];
    }),
    lastWords: a.events.find((x) => x.e["type"] === "done")?.e["text"],
    failed: a.events.find((x) => x.e["type"] === "failed")?.e["why"],
  }));
}

function evidenceOf(c: Case, run: Run, code: Record<string, number>) {
  return JSON.stringify(
    {
      turns: run.turns.map((t, i) => ({
        meant: t.turn.said,
        how: t.turn.input,
        heard: run.answers[i]?.body["said"],
        gestures: t.gestures,
        sentToAgent: {
          pointedWhileSaying: run.answers[i]?.body["pointedWhileSaying"],
          circled: run.answers[i]?.body["circled"],
          page: run.answers[i]?.body["page"],
        },
      })),
      agent: stepsOf(run.answers),
      hisClicksOnTurns: run.hisClicks,
      codeChecks: { ...code, checks: run.checks },
      facts: facts(),
      guidance: c.expect.guide,
    },
    null,
    2,
  );
}

function picturesOf(run: Run): Picture[] {
  return [
    { file: run.before, label: "The page before he spoke" },
    ...run.shots.slice(0, 3).flatMap((s, i) => [
      { file: s.before, label: `Before, the area of mock-up ${String(i + 1)}` },
      { file: s.file, label: `Mock-up ${String(i + 1)}` },
    ]),
    { file: run.end, label: "The page at the end" },
  ];
}

function codeOf(c: Case, run: Run) {
  const shows = showsOf(run.answers);
  const mocks = shows.filter(({ b }) => b["replace"] !== undefined);
  const clicks = shows.filter(({ b }) => b["click"] === true).length;
  const want = c.expect;
  const mockup =
    want.mockup === "any" ||
    (want.mockup === "none" ? run.shots.length === 0 : run.shots.length > 0);
  const target =
    want.target === undefined ||
    mocks.some(({ b }) => String(b["target"]).includes(`"${want.target ?? ""}"`));
  const clicked =
    want.clicks === undefined ||
    want.clicks === "any" ||
    (want.clicks === "none" ? clicks === 0 : clicks > 0);
  const edits = (want.edits ?? "none") === "any" || run.edited === "";
  const checks = run.checks.every((x) => x.ok);
  const answered = run.answers.length >= c.turns.length && !run.timedOut;
  return {
    mockup: Number(mockup),
    target: Number(target),
    clicks: Number(clicked),
    no_edit: Number(edits),
    checks: Number(checks),
    answered: Number(answered),
  };
}

function firstBeat(run: Run) {
  const i = run.turns.length - 1;
  const answer = run.answers[i];
  const show = answer?.events.find((x) => x.e["type"] === "show");
  const end = run.turns[i]?.end;
  return show === undefined || end === undefined ? undefined : (show.at - end) / 1000;
}

async function grade(c: Case, run: Run) {
  const code = codeOf(c, run);
  const evidence = evidenceOf(c, run, code);
  const pictures = picturesOf(run);
  const verdicts: Record<string, Verdict | { error: string }> = Object.fromEntries(
    await Promise.all(
      JUDGES.map(async (j) => {
        try {
          return [j, await judge(SDK, j, evidence, pictures)] as const;
        } catch (error) {
          return [j, { error: String(error) }] as const;
        }
      }),
    ),
  );
  return { code, evidence, pictures, verdicts };
}

function gradeRow(
  code: Record<string, number>,
  verdicts: Record<string, Verdict | { error: string }>,
) {
  const codePass = Object.values(code).every((v) => v === 1);
  const judged = JUDGES.map((j) => passes(verdicts[j]));
  return {
    pass: Number(codePass && judged.every(Boolean)),
    code: Number(codePass),
    ...code,
    ...Object.fromEntries(JUDGES.map((j, i) => [j, Number(judged[i])])),
    ...Object.fromEntries(
      CLAIMS.map((claim) => [
        claim,
        Number(
          JUDGES.every((j) => {
            const v = verdicts[j];
            return v !== undefined && !("error" in v) && v[claim];
          }),
        ),
      ]),
    ),
    agree: Number(new Set(judged).size === 1),
  };
}

const rel = (file: string) => path.relative(RUNS, file);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const results = path.join(OUT, "results.jsonl");
  const done = new Set(
    existsSync(results)
      ? readFileSync(results, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const r = JSON.parse(l) as { prompt_id: string; rep: number };
            return `${r.prompt_id}#${String(r.rep)}`;
          })
      : [],
  );
  const only = flags.only?.split(",");
  const [shard, shards] = flags.shard.split("/").map(Number);
  const chosen = cases
    .filter(
      (c) =>
        (only === undefined || only.includes(c.id)) &&
        (only !== undefined || flags.set === "all" || c.set === flags.set),
    )
    .filter((_, i) => i % (shards ?? 1) === (shard ?? 1) - 1);
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
  });
  const judging: Promise<void>[] = [];
  try {
    for (let rep = 0; rep < Number(flags.reps); rep++)
      for (const c of chosen) {
        if (done.has(`${c.id}#${String(rep)}`)) continue;
        let run: Run;
        try {
          run = await runCase(browser, c, rep, flags.url, flags.tree);
        } catch (error) {
          appendFileSync(
            path.join(OUT, "errors.jsonl"),
            `${JSON.stringify({ prompt_id: c.id, rep, error: String(error) })}\n`,
          );
          console.log(`${c.id} rep ${String(rep)}: error ${String(error).slice(0, 200)}`);
          continue;
        }
        const r = run;
        judging.push(
          grade(c, r).then(({ code, evidence, pictures, verdicts }) => {
            const g = gradeRow(code, verdicts);
            const last = r.answers.at(-1);
            const row = {
              prompt_id: c.id,
              rep,
              prompt: c.turns.map((t) => t.said).join(" / "),
              tags: [c.group, c.set, c.turns.map((t) => t.input).join("+")],
              group: c.group,
              set: c.set,
              status: r.timedOut ? "timeout" : "ok",
              first_beat_s: firstBeat(r),
              latency_s:
                last?.ended === undefined || r.turns[0] === undefined
                  ? undefined
                  : (last.ended - r.turns[0].end) / 1000,
              heard: r.answers.map((a) => a.body["said"]),
              grade: g,
              verdicts,
              explanation: Object.fromEntries(
                JUDGES.map((j) => {
                  const v = verdicts[j];
                  return [j, v === undefined ? "" : "error" in v ? v.error : v.why];
                }),
              ),
              attachments: pictures.map((p) => ({ kind: "image", ref: rel(p.file), alt: p.label })),
              meta: {
                evidence,
                pictures: pictures.map((p) => ({ ...p, file: rel(p.file) })),
                shots: r.shots.map((s) => ({ ...s, file: rel(s.file), before: rel(s.before) })),
                edited: r.edited,
                hisClicks: r.hisClicks,
              },
            };
            appendFileSync(results, `${JSON.stringify(row)}\n`);
            console.log(
              `${c.id} rep ${String(rep)}: pass ${String(g.pass)} code ${String(g.code)} ${JUDGES.map((j) => `${j}=${String(Reflect.get(g, j))}`).join(" ")} first beat ${firstBeat(r)?.toFixed(1) ?? "-"} s | heard: ${JSON.stringify(r.answers.map((a) => a.body["said"]))}`,
            );
          }),
        );
      }
    await Promise.all(judging);
  } finally {
    await browser.close();
  }
  summary(results);
}

function summary(results: string) {
  const rows = readFileSync(results, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(
      (l) => JSON.parse(l) as { prompt_id: string; grade: { pass: number }; first_beat_s?: number },
    );
  const byCase = new Map<string, number[]>();
  for (const r of rows) byCase.set(r.prompt_id, [...(byCase.get(r.prompt_id) ?? []), r.grade.pass]);
  const means = [...byCase.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
  const p = means.reduce((a, b) => a + b, 0) / Math.max(1, means.length);
  const sd = Math.sqrt(means.reduce((a, m) => a + (m - p) ** 2, 0) / Math.max(1, means.length - 1));
  const half = (1.96 * sd) / Math.sqrt(Math.max(1, means.length));
  const beats = rows
    .map((r) => r.first_beat_s)
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b);
  console.log(
    `${VARIANT}: pass ${(p * 100).toFixed(0)}% ± ${(half * 100).toFixed(0)} over ${String(means.length)} cases (${String(rows.length)} runs); first beat median ${beats[Math.floor(beats.length / 2)]?.toFixed(1) ?? "-"} s`,
  );
}

/** Grades saved runs again, with other judges or a new rubric, from their saved evidence. */
async function rejudge() {
  const results = path.join(OUT, "results.jsonl");
  const rows = readFileSync(results, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  await Promise.all(
    rows.map(async (row) => {
      const meta = row["meta"] as { evidence: string; pictures: Picture[] };
      const pictures = meta.pictures.map((p) => ({ ...p, file: path.join(RUNS, p.file) }));
      const verdicts = Object.fromEntries(
        await Promise.all(
          JUDGES.map(async (j) => {
            try {
              return [j, await judge(SDK, j, meta.evidence, pictures)] as const;
            } catch (error) {
              return [j, { error: String(error) }] as const;
            }
          }),
        ),
      );
      if (flags.regrade) {
        const grade = row["grade"] as Record<string, number>;
        const code = Object.fromEntries(
          ["mockup", "target", "clicks", "no_edit", "checks", "answered"].map((k) => [
            k,
            grade[k] ?? 0,
          ]),
        );
        row["grade"] = gradeRow(code, verdicts);
        row["verdicts"] = verdicts;
      } else
        appendFileSync(
          path.join(OUT, "judges.jsonl"),
          `${JSON.stringify({ prompt_id: row["prompt_id"], rep: row["rep"], verdicts })}\n`,
        );
      console.log(`${String(row["prompt_id"])}: ${JSON.stringify(verdicts).slice(0, 240)}`);
    }),
  );
  if (flags.regrade) {
    writeFileSync(results, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
    summary(results);
  }
}

/** The cases as a table, for cases.md. */
function list() {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const how = (t: Turn) =>
    `${t.input}${t.circle === undefined ? "" : ` round ${t.circle.target}`}${(t.point ?? []).map((p) => ` at ${p.target}`).join("")}${t.when === "first-beat" ? ", cutting in" : ""}`;
  const lines = [
    "# Answer eval cases",
    "",
    "Written by `node evals/answers/run.ts --list > evals/answers/cases.md` from cases.json. Each turn is spoken, circled or typed. Code checks: the mock-up (none, some, any), its part, the agent's own clicks, code edits, and the listed checks. The guide is for the judges: one good answer, and what would be wrong.",
    "",
    "| id | group | set | he does | code checks | guide |",
    "| --- | --- | --- | --- | --- | --- |",
    ...cases.map(
      (c) =>
        `| ${c.id} | ${c.group} | ${c.set} | ${cell(c.turns.map((t) => `"${t.said}" (${how(t)})`).join("; then "))}${c.page === "/request" ? "" : ` on ${c.page}`}${c.remark === undefined ? "" : `, remark "${c.remark}"`} | ${cell(
          [
            `mock-up ${c.expect.mockup}${c.expect.target === undefined ? "" : ` on ${c.expect.target}`}`,
            ...(c.expect.clicks === undefined ? [] : [`agent clicks ${c.expect.clicks}`]),
            ...(c.expect.checks ?? []).map((x) => x.says),
          ].join("; "),
        )} | ${cell(c.expect.guide)} |`,
    ),
  ];
  console.log(lines.join("\n"));
}

await (flags.list ? list() : flags.rejudge ? rejudge() : main());
