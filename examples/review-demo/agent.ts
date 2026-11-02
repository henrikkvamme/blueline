import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSdkMcpServer,
  type Query,
  query,
  type SDKUserMessage,
  startup,
  tool,
  type WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { Plugin } from "vite";
import { z } from "zod";

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
 * A fast model hears him first. While Opus starts, Haiku with no thinking says in one line what
 * he asks for, about a second after he stops, so a wrong hearing shows at once. Measured on
 * fry on 2026-11-02, through the subscription: Haiku 5.5 gave its first word in 0.7 to 2.4 s,
 * and GPT-6.1 Terra through a warm Codex app-server in 3.3 to 4.7 s. Opus does the work, where
 * the design matters.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MODEL = "claude-opus-5-5";
/** The model that hears him first, with no thinking and no tools. */
const FAST = "claude-haiku-5-5";

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
    .object({ text: z.string().optional(), html: z.string().optional() })
    .optional()
    .describe(
      "A mock-up in the target's place, in its own font and colours, for this beat only: show a change before you make it. Plain text, or small inline-styled HTML.",
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

const SYSTEM = `You are the agent in Blueline's queue workshop. Henrik reviews UI by eye and judges; he does not read long text. He holds Control and Command (or presses Control twice and types), points with his mouse, may draw a loop round an element, and speaks. You get his words; what he pointed at while he said each part; a screenshot of the page and panel with his strokes drawn on it in blue, his mouse at the end marked; a close crop of each loop he drew, which is what he means most; and the page's elements with their boxes.

Trust the images over the element names: a loop means the thing inside it. Never talk about how his pointing, hovering or loops were read, or where a loop landed. Speak about the thing itself, as a person beside him would.

Answer on the page, as Clicky does, with the show tool: your cursor flies to each element, draws on it and speaks the line in a voice. That is how he hears you. Never answer in prose alone.

How to show:
- Start the first show call fast, before you read any code, unless his words need the code to answer.
- One idea per beat, two to five beats. Say short spoken sentences. Notes are at most five words.
- Draw: circle a thing, underline words, box a region, strike what should go. Add shapes when they help: an arrow from one element to another, a text label, an ellipse. Shape coordinates are px from the target's top left, from the elements' boxes.
- Mock up a change in place with replace before you make it, so he judges it by eye.
- Teach with turn: the walk waits for his own click. Click yourself only when he asks you to show or run a journey; say what you click before you click it. The app's tabs and the send button change the page: end the walk with that click. The show tool's result lists the elements of the page as it is now, so go on with the next walk from there.
- peek and state show a variant or a state of the current remark's choice.
- Use only selectors from the elements list.

He can ask you to do anything he can do in the workshop, and more. The act tool does it, in order, as his own keys would, and returns what each act did and where the review is now:
- next, back, settle (the remark that shows, then go on), undo (the last settle), open a remark by id, keep a variant or answer a question (keep), preview a variant or a state (null ends it), go to a page, walk (play the remark's walk), seen (the list of earlier remarks), stopShip, settings (voice, walks, speaker, the delay of answers in s, lessMotion);
- addVariants: design new variants of a choice as small HTML, in the app's look. They show in the element's place and on the panel's board. Add a few at once, each a clear idea. Then preview them one by one with a show, so he sees each.
- addStates: more states for a choice to go through, such as a long name;
- addRemark: write a new remark into the queue: a look, a choice with designed variants, or a question with answers, with a walk. open shows it now.
Say what you do as you do it, with a short show beat, unless the act is all he asked for.

What his words ask for:
- A question: answer with show only.
- A change to the made-up bonus app: call annotate with the element and his request in one clear sentence, then show one beat that says you are on it. The workshop sends your answer back into the queue.
- A change to the workshop or to Blueline itself: show one beat that says what you will change, then change the code under ${ROOT}. Read CLAUDE.md and GLOSSARY.md first, and follow them. The page reloads by itself. Then show him the result.

The show tool returns how the walk went: whether he watched it to the end, stopped it or clicked. You run no commands. End each turn with one line of at most eight words on what you did, for his status line, such as "Showed the send journey".`;

type Event =
  | { readonly type: "status"; readonly text: string }
  | { readonly type: "heard"; readonly text: string }
  | { readonly type: "show"; readonly id: string; readonly beats: unknown }
  | { readonly type: "annotate"; readonly target: string; readonly text: string }
  | { readonly type: "act"; readonly id: string; readonly acts: unknown }
  | { readonly type: "done"; readonly text: string }
  | { readonly type: "failed"; readonly why: string };

/** Only what the Claude Code process needs: no keys of the dev server's own. */
function envOf() {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM"];
  return Object.fromEntries(
    keep.flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k] ?? ""]])),
  );
}

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

/**
 * What the page sent, as his message to the agent: the screenshots first, each with what it
 * is, and the rest as JSON. Each loop's crop comes first, as Clicky's does: it is what he
 * means most.
 */
async function* words(text: string): AsyncGenerator<SDKUserMessage> {
  const { images, ...context } = JSON.parse(text) as {
    images?: { screen?: string; circled?: readonly string[] };
  };
  const image = (url: string) => {
    const [, type = "image/jpeg", data = ""] = /^data:([^;]+);base64,(.*)$/s.exec(url) ?? [];
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: type as "image/jpeg", data },
    };
  };
  const content = [
    ...(images?.circled ?? []).flatMap((url, i) => [
      { type: "text" as const, text: `Loop ${String(i + 1)}, close up: what he circled.` },
      image(url),
    ]),
    ...(images?.screen === undefined
      ? []
      : [
          {
            type: "text" as const,
            text: "The page and the panel as he saw them, with his strokes in blue.",
          },
          image(images.screen),
        ]),
    { type: "text" as const, text: JSON.stringify(context) },
  ];
  yield {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    origin: { kind: "human" },
  };
}

const HEAR = `Henrik reviews a web app by eye. He pointed at the page and spoke; a slower agent does what he asks. You only say back, at once, what he asks for, so he sees a wrong hearing before the agent starts. One line of at most twelve words, starting with a verb, in plain words: "Make the pill green once it is approved." For a question, say what he asks: "Asks what 'Waiting on approvers' means." Never answer it, never say how you read his pointing, and never add anything else.`;

/**
 * The fast model's process, started before he speaks, so a hearing does not wait for Claude
 * Code to start. Each hearing takes it, and the next one starts at once. `close` ends the one
 * that waits, with the dev server.
 */
function hearing() {
  const spare = () => {
    const stop = new AbortController();
    const warm = startup({
      options: {
        model: FAST,
        thinking: { type: "disabled" },
        tools: [],
        settingSources: [],
        systemPrompt: HEAR,
        persistSession: false,
        includePartialMessages: true,
        env: envOf(),
        abortController: stop,
      },
    });
    // A spare that fails to start fails the hearing that takes it, not the dev server.
    warm.catch(() => undefined);
    return { warm, stop };
  };
  let next: { readonly warm: Promise<WarmQuery>; readonly stop: AbortController } | undefined;
  return {
    /** Starts the process for the first hearing. */
    ready: () => {
      next ??= spare();
    },
    /**
     * Streams what it heard him ask for, in one line: `on` gets the line so far as its words
     * come, so it shows from the first word.
     */
    hear: async (text: string, signal: AbortSignal, on: (line: string) => void) => {
      const { warm, stop } = next ?? spare();
      next = spare();
      const end = () => stop.abort();
      signal.addEventListener("abort", end, { once: true });
      try {
        let said = "";
        for await (const message of (await warm).query(words(text))) {
          if (message.type !== "stream_event") continue;
          const { event } = message;
          if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
          said += event.delta.text;
          const line = said.trimStart().split("\n")[0]?.trimEnd() ?? "";
          if (line !== "") on(line);
          // One line only: what comes after it is more than he needs.
          if (said.trimStart().includes("\n")) break;
        }
      } finally {
        signal.removeEventListener("abort", end);
        stop.abort();
      }
    },
    close: () => {
      next?.stop.abort();
      next = undefined;
    },
  };
}

const inside = (path: unknown) => {
  if (typeof path !== "string") return true;
  const rel = relative(ROOT, resolve(ROOT, path));
  return !rel.startsWith("..") && !/(^|\/)(node_modules|\.git)(\/|$)/.test(rel);
};

export function agent(): Plugin {
  let session: string | undefined;
  let running: { readonly query: Query; readonly ended: Promise<void> } | undefined;
  const watching = new Map<string, (how: string) => void>();
  /** Ends when the last request has started its run, so requests start one at a time. */
  let line = Promise.resolve();
  let shown = 0;

  return {
    name: "workshop-agent",
    apply: "serve",
    configureServer(server) {
      const log = server.config.logger;
      const ears = hearing();
      ears.ready();
      server.httpServer?.once("close", ears.close);
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
      server.middlewares.use("/__agent/forget", (_req, res) => {
        session = undefined;
        void running?.query.interrupt().catch(() => undefined);
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
            const send = (event: Event) => {
              if (open) res.write(`${JSON.stringify(event)}\n`);
            };
            const gone = new AbortController();
            res.on("close", () => {
              open = false;
              gone.abort();
            });
            // The fast model hears him at once, and does not wait for the old work to stop.
            void ears
              .hear(text, gone.signal, (heard) => send({ type: "heard", text: heard }))
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
            /** A new id, and what the page answers on it. */
            const await_ = () => {
              const id = `w${String(++shown)}`;
              const how = new Promise<string>((done) => {
                watching.set(id, done);
                setTimeout(() => done("No word from the page; it may still play."), WATCH);
              });
              return { id, how };
            };
            const page = createSdkMcpServer({
              name: "page",
              alwaysLoad: true,
              tools: [
                tool(
                  "show",
                  "Show Henrik on the page: the cursor walks the beats, draws and speaks each line. Returns how the walk went.",
                  { beats: z.array(beat).min(1) },
                  async ({ beats }) => {
                    const { id, how } = await_();
                    send({ type: "show", id, beats });
                    return { content: [{ type: "text", text: await how }] };
                  },
                ),
                tool(
                  "act",
                  "Do what he can do in the workshop, and more, in order: go through the queue, settle, undo, keep, preview, change the settings, design variants, add states, write remarks. Returns what each act did and where the review is now.",
                  { acts: z.array(act).min(1) },
                  async ({ acts }) => {
                    const { id, how } = await_();
                    send({ type: "act", id, acts });
                    return { content: [{ type: "text", text: await how }] };
                  },
                ),
                tool(
                  "annotate",
                  "Put a change to the made-up app in the review queue, on one element. The workshop answers it later.",
                  {
                    target: z.string().describe("A selector from the elements list."),
                    text: z.string().describe("What should change, in one clear sentence."),
                  },
                  async ({ target, text }) => {
                    send({ type: "annotate", target, text });
                    return { content: [{ type: "text", text: "In the queue." }] };
                  },
                ),
              ],
            });
            const run = query({
              prompt: words(text),
              options: {
                model: MODEL,
                effort: "low",
                cwd: ROOT,
                env: envOf(),
                settingSources: [],
                systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM },
                tools: ["Read", "Grep", "Glob", "Edit", "Write"],
                mcpServers: { page },
                canUseTool: async (name, input) =>
                  name.startsWith("mcp__page__") ||
                  (["Read", "Grep", "Glob", "Edit", "Write"].includes(name) &&
                    inside(input["file_path"] ?? input["path"]))
                    ? { behavior: "allow", updatedInput: input }
                    : {
                        behavior: "deny",
                        message: "Only files in this repository, and no commands.",
                      },
                ...(session === undefined ? {} : { resume: session }),
              },
            });
            let finish = () => undefined as void;
            running = { query: run, ended: new Promise<void>((done) => (finish = done)) };
            mine();
            send({ type: "status", text: "Thinking" });
            try {
              for await (const message of run) {
                if (session !== message.session_id) {
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
              finish();
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
