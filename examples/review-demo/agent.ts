import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkMcpServer, type Query, query, tool } from "@anthropic-ai/claude-agent-sdk";
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

const SYSTEM = `You are the agent in Blueline's queue workshop. Henrik reviews UI by eye and judges; he does not read long text. He holds Option and Command, points with his mouse, may draw a loop round an element, and speaks. You get his words, what he pointed at while he said each part, and what the page shows.

Answer on the page, as Clicky does, with the show tool: your cursor flies to each element, draws on it and speaks the line in a voice. That is how he hears you. Never answer in prose alone.

How to show:
- Start the first show call fast, before you read any code, unless his words need the code to answer.
- One idea per beat, two to five beats. Say short spoken sentences. Notes are at most five words.
- Draw: circle a thing, underline words, box a region, strike what should go. Add shapes when they help: an arrow from one element to another, a text label, an ellipse. Shape coordinates are px from the target's top left, from the elements' boxes.
- Mock up a change in place with replace before you make it, so he judges it by eye.
- Teach with turn: the walk waits for his own click. Click yourself only when he asks you to show or run a journey; say what you click before you click it. The app's tabs and the send button change the page: end the walk with that click. The show tool's result lists the elements of the page as it is now, so go on with the next walk from there.
- peek and state show a variant or a state of the current remark's choice.
- Use only selectors from the elements list.

What his words ask for:
- A question: answer with show only.
- A change to the made-up bonus app: call annotate with the element and his request in one clear sentence, then show one beat that says you are on it. The workshop sends your answer back into the queue.
- A change to the workshop or to Blueline itself: show one beat that says what you will change, then change the code under ${ROOT}. Read CLAUDE.md and GLOSSARY.md first, and follow them. The page reloads by itself. Then show him the result.

The show tool returns how the walk went: whether he watched it to the end, stopped it or clicked. You run no commands. End each turn with one line of at most eight words on what you did, for his status line, such as "Showed the send journey".`;

type Event =
  | { readonly type: "status"; readonly text: string }
  | { readonly type: "show"; readonly id: string; readonly beats: unknown }
  | { readonly type: "annotate"; readonly target: string; readonly text: string }
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
  if (name.endsWith("__show")) return undefined;
  return "Working";
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
  let shown = 0;

  return {
    name: "workshop-agent",
    apply: "serve",
    configureServer(server) {
      const log = server.config.logger;
      const body = (req: import("node:http").IncomingMessage) =>
        new Promise<string>((done) => {
          let text = "";
          req.on("data", (chunk: Buffer) => (text += chunk.toString()));
          req.on("end", () => done(text));
        });

      server.middlewares.use("/__agent/played", (req, res) => {
        void body(req).then((text) => {
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
          res.end();
        });
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
        void body(req).then(async (prompt) => {
          // New words stop the work on the old ones, and the session goes on from there.
          if (running !== undefined) {
            await running.query.interrupt().catch(() => undefined);
            await running.ended;
          }
          res.setHeader("Content-Type", "application/x-ndjson");
          res.setHeader("Cache-Control", "no-store");
          let open = true;
          const send = (event: Event) => {
            if (open) res.write(`${JSON.stringify(event)}\n`);
          };
          res.on("close", () => {
            open = false;
          });
          const page = createSdkMcpServer({
            name: "page",
            alwaysLoad: true,
            tools: [
              tool(
                "show",
                "Show Henrik on the page: the cursor walks the beats, draws and speaks each line. Returns how the walk went.",
                { beats: z.array(beat).min(1) },
                async ({ beats }) => {
                  const id = `w${String(++shown)}`;
                  const how = new Promise<string>((done) => {
                    watching.set(id, done);
                    setTimeout(() => done("No word from the page; it may still play."), WATCH);
                  });
                  send({ type: "show", id, beats });
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
            prompt,
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
        });
      });
    },
  };
}
