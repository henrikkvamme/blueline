import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSdkMcpServer,
  type Options,
  type Query,
  query,
  startup,
  tool,
  type WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { Plugin } from "vite";
import { z } from "zod";
import { type Exchange, keepFeedback } from "./feedback.ts";
import { ears as makeEars, envOf, words } from "./hearing.ts";

/*
 * The agent behind the workshop's point and talk, on the dev server only. `POST /__agent`
 * with what the reviewer said, pointed at and saw sends back a stream of events, one JSON
 * line each, as the agent works: what it does, the walks it shows on the page, the
 * annotations it puts in the queue, and its last words.
 *
 * It is Claude Code, through the Agent SDK, so it runs on the subscription that Claude Code is
 * signed in with, as T3 Code does: no API key. It answers on the page with its `show` tool, and
 * the cursor points, draws, mocks up and speaks. Each remark resumes the same session, so it
 * remembers the review, and new words stop the work on the old ones. It may change the
 * workshop's own code, so the reviewer can shape Blueline through Blueline; it runs no
 * commands. `POST /__agent/played` tells it how a walk went; `POST /__agent/forget` starts a
 * new session.
 *
 * A fast model hears him first. While Opus starts, GPT-6.1 Terra with no reasoning says in one
 * line what he asks for, so a wrong hearing shows at once. On a warm Codex thread its first
 * word came in 1.4 to 2.0 s on fry, with a screenshot, close to Haiku 5.5's 1.2 to 1.9 s, and
 * Terra reads the page better. Haiku hears when Codex cannot. Opus does the work, where the
 * design matters. See terra.ts.
 *
 * The next run starts ahead: after each run, and when the dev server starts, a Claude Code
 * process starts and resumes the session, so his next words do not wait for it to start. It
 * gets the same prompt, tools and session as a run started then, so it knows as much.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MODEL = "claude-opus-5-5";

/** How long a walk may take before the agent goes on without hearing how it went. */
const WATCH = 120_000;

const at = z.tuple([z.number(), z.number()]);
const shape = z.union([
  z.object({ kind: z.enum(["arrow", "line"]), from: at, to: at }),
  z.object({ kind: z.enum(["rect", "ellipse"]), at, size: at }),
  z.object({ kind: z.literal("text"), at, text: z.string() }),
]);
const beat = z.object({
  target: z.string().describe("A selector from the elements list. Nothing else is on the page."),
  say: z.string().describe("What the voice says: one or two short spoken sentences."),
  note: z.string().describe("At most five words beside the element; the voice says the rest."),
  draw: z.enum(["circle", "underline", "box", "strike"]).optional(),
  shapes: z
    .array(shape)
    .optional()
    .describe(
      "Shapes drawn by hand in px from the target's top left; they may go outside its box. An arrow from a note-free spot to a detail, a text label, a rect round a region.",
    ),
  replace: z
    .object({
      swap: z
        .array(z.object({ from: z.string(), to: z.string() }))
        .optional()
        .describe(
          "Words to swap in the target itself, in the page, so it keeps its exact look and the page lays out the new words. Use this whenever only words or figures change.",
        ),
      html: z
        .string()
        .optional()
        .describe(
          "New markup in the target's place in the page, only when its layout must change. Start from the element's html in the elements list, keep its classes, and change only what he asked.",
        ),
      text: z.string().optional().describe("Plain words in the target's look, for a bare label."),
    })
    .optional()
    .describe(
      "A mock-up in the target's place, for this beat only: show a change before you make it.",
    ),
  turn: z.boolean().optional().describe("Wait for the reviewer to click the target himself."),
  click: z.boolean().optional().describe("Click the target yourself after the line."),
  peek: z.string().optional().describe("A variant of the remark's choice to show."),
  state: z.string().optional().describe("A state of the remark's choice to show."),
});

const design = z.object({
  name: z.string().describe("The variant's label, a word or two."),
  html: z
    .string()
    .describe(
      "Small inline-styled HTML that stands in the element's place; it takes the element's font. {state} stands for the words of the state it shows.",
    ),
});
const act = z.union([
  z.object({
    do: z.enum(["next", "back", "settle", "undo", "walk", "stopShip"]),
  }),
  z.object({ do: z.literal("open"), remark: z.string() }),
  z.object({ do: z.literal("keep"), value: z.string(), remark: z.string().optional() }),
  z.object({
    do: z.literal("preview"),
    variant: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
  }),
  z.object({ do: z.literal("go"), page: z.string() }),
  z.object({ do: z.literal("seen"), open: z.boolean() }),
  z.object({
    do: z.literal("settings"),
    voice: z.boolean().optional(),
    walks: z.boolean().optional(),
    speaker: z.enum(["Alice", "River", "Eric"]).optional(),
    delay: z.number().optional(),
    lessMotion: z.boolean().optional(),
  }),
  z.object({ do: z.literal("addVariants"), remark: z.string(), variants: z.array(design).min(1) }),
  z.object({ do: z.literal("addStates"), remark: z.string(), states: z.array(z.string()).min(1) }),
  z.object({
    do: z.literal("addRemark"),
    open: z.boolean().optional().describe("Show it now, in place of the remark that shows."),
    remark: z.object({
      id: z.string().optional(),
      kind: z.enum(["look", "choice", "question"]),
      page: z.string(),
      target: z.string().describe("A selector from the elements list."),
      title: z.string(),
      text: z.string().optional(),
      options: z.array(z.string()).optional().describe("A question's answers."),
      states: z.array(z.string()).optional(),
      variants: z.array(design).optional().describe("A choice's variants."),
      walk: z.array(beat).optional().describe("The walk the cursor plays when it shows."),
    }),
  }),
]);

const SYSTEM = `You are the agent in Blueline's queue workshop. Henrik reviews UI by eye and judges; he does not read long text. He holds Control and Command (or presses Control twice and types), points with his mouse, may draw a loop round an element, and speaks. You get his words; what he pointed at while he said each part; a screenshot of the page and panel with his strokes drawn on it in blue, his mouse at the end marked; a close crop of each loop he drew; and the page's elements with their boxes.

His words decide what he means. Where he points and what he loops are hints: when his words name a thing, such as "the status" or "the send button", take that thing wherever it is on the page, even when his mouse or loop is somewhere else. When his words only say "this" or "here", the loop, else his mouse, says which thing. Trust the images over the element names: a loop means the thing inside it. Never talk about how his pointing, hovering or loops were read, or where a loop landed. Speak about the thing itself, as a person beside him would.

Answer on the page, as Clicky does, with the show tool: your cursor flies to each element, draws on it and speaks the line in a voice. That is how he hears you. Never answer in prose alone.

How to show:
- Start the first show call fast, before you read any code. When the answer needs the code, the first show is one beat on the part he means, such as "The status. One moment.", then read, then answer.
- One idea per beat, two to five beats. Say short spoken sentences. Notes are at most five words.
- Say only what answers him. Leave out reasons, comparisons and side remarks he did not ask for, such as why a shorter title still works or what the rest of the page looks like: each extra claim is one more that can be wrong. When your words name who gets, has or approves something, and the page does not show it, read the app's code for it. A label on a control names what that click does now: who gets it at that moment, not everyone who gets it later.
- Draw: circle a thing, underline words, box a region, strike what should go. Add shapes when they help: an arrow from one element to another, a text label, an ellipse. Shape coordinates are px from the target's top left, from the elements' boxes.
- Mock up a change in place with replace before you make it, so he judges it by eye. Change only what he asked about: when he names one part, such as the title, change that part only, even when its element holds more; every other word, label and field stays as it is. A new currency, name, date, label, figure or wording is a change of words: use replace.swap, never html, and swap only the words he asked about. Use replace.html only when the change needs new parts or a new layout; build it from the element's html in the elements list and keep the rest: copy each element you keep with its tag and class attribute exactly, so it keeps its size. It shows in the page in the element's place. Only classes already on the page have styles, so reuse classes from the elements' html, and give anything new an inline style. When he says what a part should tell ("say who it goes to", "show who approves first"), fill in the real content from the page, such as "Send to Ola Hansen", never his description as a label; speech to text may put quote marks round such words. Say only what the page or the code shows: never make up who did what, or what the app has, lacks or does; say nothing about what it lacks. A made-up value, such as a time, is fine when you call it an example. Get figures right: convert with a real rate, round to a plain figure and call it about that much; never call it today's rate or the app's rate. Never call a person he, she, him or her, not Kari, Ola, Ingrid nor anyone in the app: say their name, or they. Speak of a mock-up as a preview ("this is how it would look"), never as what the page now has. A value the app does not store, such as a date the page only gives as "2 days ago", is an example: call it an example, and say what it comes from, even when he asks for the real one. A state the page does not show now, such as approved or sent back, has its own look in the app's code, src/workshop/queue/app.tsx: read it before you mock that state up, and say nothing about the app's states you have not read. Show one mock-up, your best read, not options. A change of length or size, such as shorter or bigger, shows at a glance, by about half, so a follow-up can go further: a shorter text drops words, not only reorders them, and keeps the name of whom or what it is about, such as a person's name. A follow-up such as "even shorter" or "bigger" goes on from your last mock-up: make it clearly more so, by a measure he sees, such as fewer words for shorter, and keep what the part must still tell him, such as what a title says the page is about. When the element he points at holds smaller marked parts, change only the part under his mouse. To move a part, mock up the page element that holds both places, with the part in its new place, so it leaves its old one. To swap words, such as two names, swap both pairs in one replace.swap; it swaps them at once. To take a part away, mock it up with replace.html set to nothing.
- Teach with turn: the walk waits for his own click. When he asks how he would do something ("show me how I send this"), teach: point at each control with turn and let him click. Click yourself only when he asks you to do it for him ("click through it", "run it for me"); say what you click before you click it. The app's tabs and the send button change the page: end the walk with that click. The show tool's result lists the elements of the page as it is now, so go on with the next walk from there.
- peek and state show a variant or a state of the current remark's choice.
- Use only selectors from the elements list.

He can ask you to do anything he can do in the workshop, and more. The act tool does it, in order, as his own keys would, and returns what each act did and where the review is now:
- next, back, settle (the remark that shows, then go on), undo (the last settle), open a remark by id, keep a variant or answer a question (keep), preview a variant or a state (null ends it), go to a page, walk (play the remark's walk), seen (the list of earlier remarks), stopShip, settings (voice, walks, speaker, the delay of answers in s, lessMotion);
- addVariants: design new variants of a choice as small HTML, in the app's look: start from the element's html as it shows now, and change only what he asked. They show in the element's place and on the panel's board. Add a few at once, each a clear idea, or the one he asked for. Then show each with a beat whose peek is its name, so he sees it on the page.
- addStates: more states for a choice to go through, such as a long name;
- addRemark: write a new remark into the queue: a look, a choice with designed variants, or a question with answers, with a walk. open shows it now.
Say what you do as you do it, with a short show beat, unless the act is all he asked for.

What his words ask for:
- A question, or a request to explain: answer with show only, in words and drawing; mock up nothing unless he asks how something would look or what it would say. To explain what a part means, point and say it; do not show its other states. A question on what the app means, does or has, such as what a status means or who has the request, needs its code: read src/workshop/queue/app.tsx and src/workshop/queue/script.ts first, then answer only from them and the page. Read each file whole, every page of the app in it, before you answer, and work out what follows from what they say together, such as from an order of states and a line on another page. When you still do not find it, say that you did not find it, never that the app or its code does not say; never guess what has happened to the request.
- Words that ask for nothing, such as "uh", "hmm" or "wait": do nothing, or ask in one short line what he wants. Draw on nothing and change nothing.
- He says your last answer was wrong, or not what he meant: call feedback once with what was wrong and what he wanted, then do it right.
- A look at a change to the made-up bonus app ("what if", "how would it look", "show me"): mock it up in place with show, and stop there.
- A change he asks for ("make", "put", "move", "change"): first mock it up in place with show, so he sees it; then call annotate with the element and his request in one clear sentence, and say in a beat that it is in the queue. A follow-up that refines a request you queued on the same part, such as "even shorter", revises it: call annotate with revises, and say the request in the queue changed. The workshop sends your answer back into the queue.
- Real code or a deploy for the made-up app: you do not change its code here, and the workshop cannot deploy or ship it; a coding agent changes it later from the queue. Say so in one beat, and offer the mock-up and the queue; never offer to change code or a worktree for it.
- A change to the workshop or to Blueline itself: show one beat that says what you will change, then change the code under ${ROOT}. Read CLAUDE.md and GLOSSARY.md first, and follow them. The page reloads by itself. Then show him the result.

The show tool returns how the walk went: whether he watched it to the end, stopped it or clicked. When it says the walk lost its element or stopped, never say that the rest showed. You run no commands. End each turn with one line of at most eight words on what you did, for his status line, such as "Showed the send journey". Say what you did, never what he did, such as whether he watched.`;

type Event =
  | { readonly type: "status"; readonly text: string }
  | { readonly type: "heard"; readonly text: string; readonly ear: string }
  | { readonly type: "show"; readonly id: string; readonly beats: unknown }
  | {
      readonly type: "annotate";
      readonly target: string;
      readonly text: string;
      readonly revises: boolean;
    }
  | { readonly type: "act"; readonly id: string; readonly acts: unknown }
  | { readonly type: "done"; readonly text: string }
  | { readonly type: "failed"; readonly why: string };

/** What a tool call does, in a few words for his status line. */
function doing(name: string, input: Record<string, unknown>) {
  const file = typeof input["file_path"] === "string" ? basename(input["file_path"]) : "";
  if (name === "Read") return `Reading ${file}`;
  if (name === "Edit" || name === "Write") return `Changing ${file}`;
  if (name === "Grep" || name === "Glob") return "Looking through the code";
  if (name.endsWith("__annotate")) return "Putting it in the queue";
  if (name.endsWith("__act")) return undefined;
  if (name.endsWith("__show")) return undefined;
  return "Working";
}

const inside = (path: unknown) => {
  if (typeof path !== "string") return true;
  const rel = relative(ROOT, resolve(ROOT, path));
  return !rel.startsWith("..") && !/(^|\/)(node_modules|\.git)(\/|$)/.test(rel);
};

/** What the page's tools send to: the request that runs now. */
interface Out {
  send: (event: Event) => void;
  /** The exchange before this request, for feedback on it. */
  before: Exchange | undefined;
  /** What the page sent with this request. */
  request: unknown;
}

const ALLOWED = ["Read", "Grep", "Glob", "Edit", "Write"];

export function agent(): Plugin {
  let session: string | undefined;
  let running: { readonly query: Query; readonly ended: Promise<void> } | undefined;
  const watching = new Map<string, (how: string) => void>();
  /** Ends when the last request has started its run, so requests start one at a time. */
  let line = Promise.resolve();
  let shown = 0;
  /** Counts the forgets, so a run that was forgotten does not bring its session back. */
  let era = 0;
  /** The last few exchanges as they ran, for feedback on one of them. */
  const exchanges: Exchange[] = [];

  return {
    name: "workshop-agent",
    apply: "serve",
    configureServer(server) {
      const log = server.config.logger;
      const ears = makeEars({
        warn: (why) => log.warn(`workshop agent: ${why}`),
      });
      ears.ready();
      /** The request that the page's tools send to. */
      const out: Out = { send: () => undefined, before: undefined, request: undefined };
      /** A new id, and what the page answers on it. */
      const await_ = () => {
        const id = `w${String(++shown)}`;
        const how = new Promise<string>((done) => {
          watching.set(id, done);
          setTimeout(() => done("No word from the page; it may still play."), WATCH);
        });
        return { id, how };
      };
      /** The page's tools, for one run. */
      const tools = () =>
        createSdkMcpServer({
          name: "page",
          alwaysLoad: true,
          tools: [
            tool(
              "show",
              "Show Henrik on the page: the cursor walks the beats, draws and speaks each line. Returns how the walk went.",
              { beats: z.array(beat).min(1) },
              async ({ beats }) => {
                const { id, how } = await_();
                out.send({ type: "show", id, beats });
                return { content: [{ type: "text", text: await how }] };
              },
            ),
            tool(
              "act",
              "Do what he can do in the workshop, and more, in order: go through the queue, settle, undo, keep, preview, change the settings, design variants, add states, write remarks. Returns what each act did and where the review is now.",
              { acts: z.array(act).min(1) },
              async ({ acts }) => {
                const { id, how } = await_();
                out.send({ type: "act", id, acts });
                return { content: [{ type: "text", text: await how }] };
              },
            ),
            tool(
              "feedback",
              "Keep his feedback when he says your last answer was wrong, so it becomes a test of you. Call it once, then do it right.",
              {
                wrong: z.string().describe("What was wrong with the last answer, in his words."),
                wanted: z.string().describe("What he wanted instead, in his words."),
              },
              async ({ wrong, wanted }) => {
                const id = await keepFeedback(ROOT, {
                  reason: `${wrong} He wanted: ${wanted}`,
                  by: "voice",
                  exchange: out.before,
                  page: { said: out.request },
                });
                log.info(`workshop agent: kept feedback ${id}`);
                return { content: [{ type: "text", text: "Kept. Now do it right." }] };
              },
            ),
            tool(
              "annotate",
              "Put a change to the made-up app in the review queue, on one element. The workshop answers it later.",
              {
                target: z.string().describe("A selector from the elements list."),
                text: z.string().describe("What should change, in one clear sentence."),
                revises: z
                  .boolean()
                  .optional()
                  .describe(
                    'True when this refines the request you queued before on the same element, such as "even shorter": it takes that request\'s place.',
                  ),
              },
              async ({ target, text, revises }) => {
                out.send({ type: "annotate", target, text, revises: revises === true });
                return {
                  content: [
                    {
                      type: "text",
                      text: revises === true ? "Changed in the queue." : "In the queue.",
                    },
                  ],
                };
              },
            ),
          ],
        });
      /** The options of a run that goes on with `resume`, or starts a new session. */
      const options = (resume: string | undefined): Options => ({
        model: MODEL,
        effort: "low",
        cwd: ROOT,
        env: envOf(),
        settingSources: [],
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM },
        tools: ALLOWED,
        mcpServers: { page: tools() },
        canUseTool: async (name, input) =>
          name.startsWith("mcp__page__") ||
          (ALLOWED.includes(name) && inside(input["file_path"] ?? input["path"]))
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "Only files in this repository, and no commands." },
        ...(resume === undefined ? {} : { resume }),
      });
      /** The next run, started ahead on the session as it is now. */
      let next:
        | { readonly session: string | undefined; readonly warm: Promise<WarmQuery> }
        | undefined;
      const ahead = () => {
        void next?.warm.then((w) => w.close()).catch(() => undefined);
        const warm = startup({ options: options(session) });
        // A run that fails to start fails the request that takes it, not the dev server.
        warm.catch(() => undefined);
        next = { session, warm };
      };
      /** A run on the session: the one started ahead, if it is on the same session. */
      const take = async (prompt: ReturnType<typeof words>): Promise<Query> => {
        const ready = next;
        next = undefined;
        if (ready !== undefined && ready.session === session) {
          try {
            return (await ready.warm).query(prompt);
          } catch (error) {
            log.warn(`workshop agent: the run started ahead failed: ${String(error)}`);
          }
        } else void ready?.warm.then((w) => w.close()).catch(() => undefined);
        return query({ prompt, options: options(session) });
      };
      ahead();
      server.httpServer?.once("close", () => {
        ears.close();
        void next?.warm.then((w) => w.close()).catch(() => undefined);
        next = undefined;
      });
      const body = (req: import("node:http").IncomingMessage) =>
        new Promise<string>((done) => {
          let text = "";
          req.on("data", (chunk: Buffer) => (text += chunk.toString()));
          req.on("end", () => done(text));
        });

      server.middlewares.use("/__agent/played", (req, res) => {
        void body(req)
          .then((text) => {
            const { id, how, page, elements } = JSON.parse(text) as {
              id: string;
              how: string;
              page: string;
              elements: unknown;
            };
            watching.get(id)?.(
              `${how}\nThe page now: ${page}. Its elements: ${JSON.stringify(elements)}`,
            );
            watching.delete(id);
          })
          .catch((error: unknown) => log.warn(`workshop agent: ${String(error)}`))
          .finally(() => res.end());
      });
      server.middlewares.use("/__agent/feedback", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          void new Response(new Uint8Array(Buffer.concat(chunks)), {
            headers: { "Content-Type": req.headers["content-type"] ?? "" },
          })
            .formData()
            .then(async (form) => {
              const sent = form.get("feedback");
              if (typeof sent !== "string") throw new Error("No feedback in the form");
              const page = JSON.parse(sent) as { reason: string };
              const audio = form.get("audio");
              const id = await keepFeedback(
                ROOT,
                { reason: page.reason, by: "box", exchange: exchanges.at(-1), page },
                audio instanceof Blob ? new Uint8Array(await audio.arrayBuffer()) : undefined,
              );
              log.info(`workshop agent: kept feedback ${id}`);
            })
            .catch((error: unknown) => {
              log.warn(`workshop agent, feedback: ${String(error)}`);
              res.statusCode = 500;
            })
            .finally(() => res.end());
        });
      });
      server.middlewares.use("/__agent/forget", (_req, res) => {
        session = undefined;
        era += 1;
        exchanges.length = 0;
        void running?.query.interrupt().catch(() => undefined);
        if (running === undefined) ahead();
        res.end();
      });
      server.middlewares.use("/__agent", (req, res, next) => {
        if (req.url !== "/" && req.url !== "") return next();
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        void body(req)
          .then(async (text) => {
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Cache-Control", "no-store");
            let open = true;
            const record: Exchange = {
              asked: new Date().toISOString(),
              request: (() => {
                try {
                  return JSON.parse(text) as unknown;
                } catch {
                  return text;
                }
              })(),
              events: [],
            };
            const before_ = exchanges.at(-1);
            exchanges.push(record);
            if (exchanges.length > 6) exchanges.shift();
            const send = (event: Event) => {
              record.events.push(event);
              if (open) res.write(`${JSON.stringify(event)}\n`);
            };
            const gone = new AbortController();
            res.on("close", () => {
              open = false;
              gone.abort();
            });
            // The fast model hears him at once, and does not wait for the old work to stop.
            const asked = Date.now();
            let first = true;
            const heard = ears
              .hear(text, gone.signal, (line, ear) => {
                if (first)
                  log.info(`workshop agent: ${ear} heard in ${String(Date.now() - asked)} ms`);
                first = false;
                send({ type: "heard", text: line, ear });
              })
              .catch((error: unknown) => {
                if (!gone.signal.aborted) log.warn(`workshop agent, hearing: ${String(error)}`);
              });
            // New words stop the work on the old ones, and the session goes on from there.
            // Words that come while the old work stops wait in line behind it.
            const before = line;
            let mine = () => undefined as void;
            line = new Promise<void>((done) => (mine = done));
            await before;
            const was = running;
            if (was !== undefined) {
              await was.query.interrupt().catch(() => undefined);
              await was.ended;
            }
            out.send = send;
            out.before = before_;
            out.request = record.request;
            const run = await take(words(text));
            let finish = () => undefined as void;
            const ofEra = era;
            running = { query: run, ended: new Promise<void>((done) => (finish = done)) };
            mine();
            send({ type: "status", text: "Thinking" });
            try {
              for await (const message of run) {
                if (era === ofEra && session !== message.session_id) {
                  session = message.session_id;
                  log.info(`workshop agent: session ${session} (claude --resume ${session})`);
                }
                if (message.type === "assistant")
                  for (const block of message.message.content)
                    if (block.type === "tool_use") {
                      const text = doing(block.name, block.input as Record<string, unknown>);
                      if (text !== undefined) send({ type: "status", text });
                    }
                if (message.type === "result")
                  send(
                    message.subtype === "success"
                      ? { type: "done", text: message.result.trim() }
                      : { type: "failed", why: "Stopped" },
                  );
              }
            } catch (error) {
              log.warn(`workshop agent: ${String(error)}`);
              send({ type: "failed", why: "The agent stopped" });
            } finally {
              for (const [id, done] of watching) {
                done("Stopped.");
                watching.delete(id);
              }
              running = undefined;
              // The next run starts now, so his next words do not wait for it.
              ahead();
              finish();
              // A quick agent can end before the hearing: the line still says what it heard.
              await Promise.race([heard, new Promise((done) => setTimeout(done, 8_000))]);
              res.end();
            }
          })
          .catch((error: unknown) => {
            // Nothing that goes wrong with one request stops the dev server.
            log.warn(`workshop agent: ${String(error)}`);
            if (!res.headersSent) res.statusCode = 500;
            res.end();
          });
      });
    },
  };
}
