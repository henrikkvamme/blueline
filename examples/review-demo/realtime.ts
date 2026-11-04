import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { type AppMap, appMap, mapText, partsOf } from "./map.ts";

/*
 * The fast tier's key (ADR 0008), on the dev server only. `POST /__realtime/token?voice=`
 * sends back a short-lived key for one OpenAI realtime session, with its model, voice,
 * instructions and tools set here, so the page connects to OpenAI over WebRTC and never sees
 * `OPENAI_API_KEY`. Without the key the route answers 503, and the workshop hears him the old
 * way. The app's map, which the agent writes (map.ts), goes into each new session. A session
 * keeps the map's version: `GET /__realtime/session?have=` sends back the instructions and
 * tools of a newer map, so a session that began before the map, or with an older one, gets it.
 */

const MODEL = "gpt-realtime-2.1";

const INSTRUCTIONS = `You drive a design review page by voice, for one reviewer. He holds two keys while he speaks and points with his mouse. Each turn gives you the page as he sees it, then his words.

Act at once:
- A command that the tools below can do: call exactly one tool, and say nothing. The page shows what happened.
- "Looks good", "fine", "that's right" or the like about the open remark: call settle.
- "This one", "that" or "here" means what he pointed at.
- He asks to see the part in one of the open remark's states, also as a question, such as "how does it look once it's approved?": call state.
- He asks you to show him how to do something in the app, or to click through it for him: call walk with every step in order, and say nothing; each step speaks its own line. Use turn when he asks how he would do it, so he clicks himself; use click only when he asks you to do it for him. Walk only when the map shows every step: each click is his, in this app, on a part that the map says does it. A task that no part does, or that another person does, goes to ask_deep_agent. A part that he drags is not clicked: point at it, and say to drag it. When you are not sure which parts or in what order, call ask_deep_agent instead.
- Anything else, such as a question, a change to the design, a judgement, or anything that needs the page read: first say a few words, such as "Let me look", then call ask_deep_agent with his words as he said them. Its depth is deep for a change to the design or the workshop, a mock-up, a new remark, or a question on how the code works; it is quick for a question on what the page shows or means. Never answer such a request yourself, and never say what the answer will be.

Never say that something was done before its tool has run. Speak English, calmly, in very few words.`;

const none = { type: "object", properties: {}, required: [] } as const;

/** What the voice model knows of the app: its map, or only the page as it is. */
const knowledge = (map: AppMap | undefined) =>
  map === undefined
    ? "There is no map of the app yet, so you cannot walk him through it: hand every journey to ask_deep_agent."
    : `${mapText(map)}\nA step after a click that opens a page points at a part of that page, not at its tab.`;

const tools = (map: AppMap | undefined) =>
  [
    { name: "next", description: "Go to the next remark.", parameters: none },
    { name: "back", description: "Go back to the remark before.", parameters: none },
    {
      name: "settle",
      description: "Settle the open remark: he is done with it, and the next one opens.",
      parameters: none,
    },
    { name: "undo", description: "Take back the last change, as his undo key.", parameters: none },
    {
      name: "preview",
      description: "Show option or variant n of the open remark on the page.",
      parameters: {
        type: "object",
        properties: { n: { type: "integer", description: "The option's number, from 1." } },
        required: ["n"],
      },
    },
    {
      name: "state",
      description:
        "Show state n of the open remark's part on the page, such as a long name or an error. It shows until he settles or moves on.",
      parameters: {
        type: "object",
        properties: { n: { type: "integer", description: "The state's number, from 1." } },
        required: ["n"],
      },
    },
    {
      name: "keep",
      description: "Keep an option or variant of the open remark: n, or else the one shown.",
      parameters: {
        type: "object",
        properties: { n: { type: "integer", description: "The option's number, from 1." } },
        required: [],
      },
    },
    {
      name: "point",
      description: "Point at a part of the page, so he sees where it is.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "The part's selector from the page list." },
        },
        required: ["target"],
      },
    },
    {
      name: "walk",
      description:
        "Walk him through the app with the cursor, step by step, also across pages: a click opens the page that the next step is on. Each step speaks its line, then points, clicks or waits for his click. To point at one part, call point instead.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                part: { type: "string", enum: map === undefined ? [] : partsOf(map) },
                do: {
                  type: "string",
                  enum: ["point", "click", "turn"],
                  description:
                    "point: show where it is. click: click it for him. turn: wait for his own click.",
                },
                say: {
                  type: "string",
                  description:
                    'One short spoken sentence for this step, such as "Open the Approvers tab."',
                },
              },
              required: ["part", "do", "say"],
            },
          },
        },
        required: ["steps"],
      },
    },
    { name: "play", description: "Play the walk of the open remark.", parameters: none },
    { name: "pause", description: "Pause the walk.", parameters: none },
    {
      name: "ask_deep_agent",
      description:
        "Hand a question, a change or a hard request to the deep agent. It reads the page and answers there itself, with its own cursor and voice.",
      parameters: {
        type: "object",
        properties: {
          request: { type: "string", description: "His words, as he said them." },
          depth: {
            type: "string",
            enum: ["quick", "deep"],
            description:
              "deep: a change, a mock-up, a new remark or a question on the code. quick: a question on what the page shows or means.",
          },
        },
        required: ["request", "depth"],
      },
    },
  ]
    // Without the map it knows no part off the page, so a journey goes to the deep agent.
    .filter((tool) => map !== undefined || tool.name !== "walk")
    .map((tool) => ({ type: "function", ...tool }));

/** Which map a session knows: none is "". */
const versionOf = (map: AppMap | undefined) =>
  map === undefined
    ? ""
    : createHash("sha256").update(JSON.stringify(map)).digest("hex").slice(0, 16);

export function realtime(): Plugin {
  return {
    name: "workshop-realtime",
    apply: "serve",
    configureServer(server) {
      const log = (line: string) => server.config.logger.info(line, { timestamp: true });
      // The agent writes a missing or stale map now, so the first session has it.
      appMap(log);
      server.middlewares.use("/__realtime/map", (_req, res) => {
        const map = appMap(log);
        res.statusCode = map === undefined ? 404 : 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(map ?? null));
      });
      server.middlewares.use("/__realtime/session", (req, res) => {
        const map = appMap(log);
        const version = versionOf(map);
        if (new URL(req.url ?? "/", "http://here").searchParams.get("have") === version) {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          JSON.stringify({
            version,
            instructions: `${INSTRUCTIONS}\n\n${knowledge(map)}`,
            tools: tools(map),
          }),
        );
      });
      server.middlewares.use("/__realtime/token", (req, res) => {
        const key = process.env["OPENAI_API_KEY"];
        if (req.method !== "POST" || key === undefined || key === "") {
          res.statusCode = key === undefined || key === "" ? 503 : 405;
          res.end();
          return;
        }
        const voice = new URL(req.url ?? "/", "http://here").searchParams.get("voice") ?? "marin";
        const map = appMap(log);
        fetch("https://api.openai.com/v1/realtime/client_secrets", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            session: {
              type: "realtime",
              model: MODEL,
              instructions: `${INSTRUCTIONS}\n\n${knowledge(map)}`,
              audio: {
                input: {
                  turn_detection: null,
                  noise_reduction: { type: "near_field" },
                  transcription: { model: "gpt-realtime-whisper" },
                },
                output: { voice },
              },
              tools: tools(map),
              tool_choice: "auto",
            },
          }),
        })
          .then(async (r) => {
            if (!r.ok) throw new Error(`OpenAI ${String(r.status)}: ${await r.text()}`);
            const { value } = (await r.json()) as { value: string };
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify({ value, model: MODEL, version: versionOf(map) }));
          })
          .catch((error: unknown) => {
            server.config.logger.warn(String(error));
            res.statusCode = 502;
            res.end();
          });
      });
    },
  };
}
