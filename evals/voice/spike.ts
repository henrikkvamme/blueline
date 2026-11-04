import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
 * The voice spike (ADR 0008): how fast does a realtime voice agent call a page tool after he
 * stops speaking? Each command is spoken once by ElevenLabs text to speech, kept under
 * evals/voice/audio/, and streamed at the pace of speech. OpenAI gets push-to-talk: the
 * buffer is committed at the release. ElevenLabs has no push-to-talk, so silence follows the
 * speech until its turn model ends the turn. Needs OPENAI_API_KEY and ELEVENLABS_API_KEY.
 *
 *   node evals/voice/spike.ts [rounds] [openai|elevenlabs]
 */

const DIR = path.join(import.meta.dirname, "audio");
const RUNS = path.join(import.meta.dirname, "runs");
const VOICE = "JBFqnCBsd6RMkjVDRZzb";
const OPENAI_KEY = process.env["OPENAI_API_KEY"] ?? "";
const ELEVEN_KEY = process.env["ELEVENLABS_API_KEY"] ?? "";
const ROUNDS = Number(process.argv[2] ?? "2");
const ONLY = process.argv[3];

interface Command {
  readonly said: string;
  readonly tool: string;
}

const COMMANDS: readonly Command[] = [
  { said: "Go to the next one.", tool: "next" },
  { said: "Go back.", tool: "back" },
  { said: "Settle this.", tool: "settle" },
  { said: "Show me option two.", tool: "preview" },
  { said: "Keep that one.", tool: "keep" },
  { said: "Point at the approvers.", tool: "point" },
  { said: "Pause.", tool: "pause" },
  { said: "Why would the reviewer want two approvers here?", tool: "ask_deep_agent" },
];

const PROMPT = [
  "You drive a design review page by voice for one reviewer.",
  "For a command, call exactly one tool at once, and do not speak before it.",
  "For a question, or anything that needs the page read or judgement, call ask_deep_agent with his words.",
  "Speak only a few words, and only after a tool.",
].join(" ");

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly properties: Record<string, { readonly type: string; readonly description: string }>;
    readonly required: readonly string[];
  };
}

const none = { type: "object", properties: {}, required: [] } as const;
const TOOLS: readonly Tool[] = [
  { name: "next", description: "Go to the next remark in the queue.", parameters: none },
  { name: "back", description: "Go back to the remark before.", parameters: none },
  { name: "settle", description: "Settle the open remark: it is done.", parameters: none },
  {
    name: "preview",
    description: "Show option or variant n of the open remark on the page.",
    parameters: {
      type: "object",
      properties: { n: { type: "integer", description: "The option's number, from 1." } },
      required: ["n"],
    },
  },
  { name: "keep", description: "Keep the option that is shown.", parameters: none },
  {
    name: "point",
    description: "Point at a part of the page by its name.",
    parameters: {
      type: "object",
      properties: { target: { type: "string", description: "The part, in his words." } },
      required: ["target"],
    },
  },
  { name: "play", description: "Play the agent's walk.", parameters: none },
  { name: "pause", description: "Pause the agent's walk.", parameters: none },
  {
    name: "ask_deep_agent",
    description: "Hand a question or a hard request to the deep agent, which reads the page.",
    parameters: {
      type: "object",
      properties: { request: { type: "string", description: "His request, in his words." } },
      required: ["request"],
    },
  },
];

interface Result {
  readonly via: string;
  readonly said: string;
  readonly want: string;
  readonly tool?: string;
  readonly args?: string;
  readonly heard?: string;
  /** From the end of speech, in ms. */
  readonly named?: number;
  readonly called?: number;
  readonly spoke?: number;
  readonly error?: string;
}

async function pcm(text: string, rate: number): Promise<Buffer> {
  const file = path.join(
    DIR,
    `${Buffer.from(`${VOICE} ${rate} ${text}`).toString("base64url")}.pcm`,
  );
  if (existsSync(file)) return readFileSync(file);
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=pcm_${String(rate)}`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_v4" }),
    },
  );
  if (!r.ok) throw new Error(`Text to speech ${String(r.status)}: ${await r.text()}`);
  const lead = Buffer.alloc(Math.round(rate * 0.3) * 2);
  const audio = Buffer.concat([lead, Buffer.from(await r.arrayBuffer())]);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, audio);
  return audio;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function stream(audio: Buffer, rate: number, send: (chunk: Buffer) => void) {
  const size = Math.round(rate * 0.04) * 2;
  const start = performance.now();
  for (let at = 0, i = 0; at < audio.length; at += size, i++) {
    send(audio.subarray(at, at + size));
    await wait(Math.max(0, start + (i + 1) * 40 - performance.now()));
  }
}

function open(url: string, protocols?: string[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error(`Could not open ${url.split("?")[0]}`)), {
      once: true,
    });
  });
}

async function openai(model: string, command: Command): Promise<Result> {
  const audio = await pcm(command.said, 24_000);
  const ws = await open(`wss://api.openai.com/v1/realtime?model=${model}`, [
    "realtime",
    `openai-insecure-api-key.${OPENAI_KEY}`,
  ]);
  const send = (event: object) => ws.send(JSON.stringify(event));
  let end = 0;
  const marks: { named?: number; called?: number; spoke?: number } = {};
  let tool: string | undefined;
  let args: string | undefined;
  let heard: string | undefined;
  let error: string | undefined;
  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 15_000);
    ws.addEventListener("message", (m) => {
      const e = JSON.parse(String(m.data)) as Record<string, any>;
      const t = performance.now() - end;
      if (e.type === "error") {
        error = String(e.error?.message ?? "error");
        clearTimeout(timer);
        resolve();
      } else if (e.type === "response.output_item.added" && e.item?.type === "function_call") {
        marks.named ??= t;
        tool ??= e.item.name;
      } else if (e.type === "response.function_call_arguments.done") {
        marks.called ??= t;
        args ??= e.arguments;
      } else if (
        e.type === "response.output_audio.delta" ||
        e.type === "response.output_text.delta"
      ) {
        marks.spoke ??= t;
      } else if (e.type === "conversation.item.input_audio_transcription.completed") {
        heard = e.transcript;
      } else if (e.type === "response.done") {
        clearTimeout(timer);
        setTimeout(resolve, 300);
      }
    });
  });
  const ready = new Promise<void>((resolve) =>
    ws.addEventListener("message", (m) => {
      if (String(m.data).includes('"session.updated"')) resolve();
    }),
  );
  send({
    type: "session.update",
    session: {
      type: "realtime",
      instructions: PROMPT,
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24_000 },
          turn_detection: null,
          transcription: { model: "gpt-realtime-whisper" },
        },
        output: { voice: "marin" },
      },
      tools: TOOLS.map((t) => ({ type: "function", ...t })),
      tool_choice: "auto",
    },
  });
  await Promise.race([ready, wait(5_000)]);
  await stream(audio, 24_000, (chunk) =>
    send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }),
  );
  end = performance.now();
  send({ type: "input_audio_buffer.commit" });
  send({ type: "response.create" });
  await done;
  ws.close();
  return {
    via: model,
    said: command.said,
    want: command.tool,
    ...(tool === undefined ? {} : { tool }),
    ...(args === undefined ? {} : { args }),
    ...(heard === undefined ? {} : { heard }),
    ...marks,
    ...(error === undefined ? {} : { error }),
  };
}

async function eleven(path_: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`https://api.elevenlabs.io${path_}`, {
    ...init,
    headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`ElevenLabs ${path_} ${String(r.status)}: ${await r.text()}`);
  return r.status === 204 ? undefined : r.json();
}

async function agent(llm: string): Promise<string> {
  const made = (await eleven("/v1/convai/agents/create", {
    method: "POST",
    body: JSON.stringify({
      name: `Blueline voice spike (${llm})`,
      conversation_config: {
        agent: {
          first_message: "",
          language: "en",
          prompt: {
            prompt: PROMPT,
            llm,
            temperature: 0,
            tools: TOOLS.map((t) => ({
              type: "client",
              ...t,
              expects_response: false,
              pre_tool_speech: "off",
            })),
          },
        },
        tts: { voice_id: VOICE, model_id: "eleven_flash_v2" },
        asr: { user_input_audio_format: "pcm_16000" },
        turn: { turn_eagerness: "eager" },
        conversation: {
          client_events: ["user_transcript", "agent_response", "client_tool_call", "audio", "ping"],
        },
      },
    }),
  })) as { agent_id: string };
  return made.agent_id;
}

async function elevenlabs(llm: string, id: string, command: Command): Promise<Result> {
  const audio = await pcm(command.said, 16_000);
  const { signed_url } = (await eleven(
    `/v1/convai/conversation/get-signed-url?agent_id=${id}`,
  )) as { signed_url: string };
  const ws = await open(signed_url);
  const send = (event: object) => ws.send(JSON.stringify(event));
  let end = Number.POSITIVE_INFINITY;
  let over = false;
  const marks: { named?: number; called?: number; spoke?: number } = {};
  let tool: string | undefined;
  let args: string | undefined;
  let heard: string | undefined;
  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 15_000);
    ws.addEventListener("message", (m) => {
      const e = JSON.parse(String(m.data)) as Record<string, any>;
      const t = performance.now() - end;
      if (e.type === "ping") send({ type: "pong", event_id: e.ping_event.event_id });
      else if (e.type === "user_transcript") heard = e.user_transcription_event.user_transcript;
      else if (e.type === "client_tool_call") {
        marks.named ??= t;
        marks.called ??= t;
        tool ??= e.client_tool_call.tool_name;
        args ??= JSON.stringify(e.client_tool_call.parameters);
        clearTimeout(timer);
        setTimeout(resolve, 300);
      } else if (e.type === "audio" || e.type === "agent_response") {
        marks.spoke ??= t;
        if (tool === undefined && e.type === "agent_response") {
          clearTimeout(timer);
          setTimeout(resolve, 300);
        }
      }
    });
  });
  const ready = new Promise<void>((resolve) =>
    ws.addEventListener("message", (m) => {
      if (String(m.data).includes("conversation_initiation_metadata")) resolve();
    }),
  );
  send({ type: "conversation_initiation_client_data" });
  await Promise.race([ready, wait(5_000)]);
  await stream(audio, 16_000, (chunk) => send({ user_audio_chunk: chunk.toString("base64") }));
  end = performance.now();
  const silence = Buffer.alloc(1280);
  void (async () => {
    while (!over) {
      send({ user_audio_chunk: silence.toString("base64") });
      await wait(40);
    }
  })();
  await done;
  over = true;
  ws.close();
  return {
    via: `elevenlabs ${llm}`,
    said: command.said,
    want: command.tool,
    ...(tool === undefined ? {} : { tool }),
    ...(args === undefined ? {} : { args }),
    ...(heard === undefined ? {} : { heard }),
    ...marks,
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? undefined : s[Math.floor((s.length - 1) / 2)];
};

if (OPENAI_KEY === "" || ELEVEN_KEY === "")
  throw new Error("Set OPENAI_API_KEY and ELEVENLABS_API_KEY");
const results: Result[] = [];
const keep = (r: Result) => {
  results.push(r);
  const ms = (x?: number) => (x === undefined ? "-" : `${String(Math.round(x))} ms`);
  console.log(
    [
      r.via.padEnd(34),
      r.said.padEnd(50),
      (r.tool ?? "none").padEnd(15),
      ms(r.called).padStart(8),
      ms(r.spoke).padStart(8),
      r.error ?? "",
    ].join(" "),
  );
};
for (const model of ONLY === "elevenlabs" ? [] : ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"])
  for (let round = 0; round < ROUNDS; round++)
    for (const c of COMMANDS)
      keep(
        await openai(model, c).catch((e: Error) => ({
          via: model,
          said: c.said,
          want: c.tool,
          error: e.message,
        })),
      );
for (const llm of ONLY === "openai" ? [] : ["gemini-3.5-flash-lite", "claude-haiku-5-5"]) {
  const id = await agent(llm);
  try {
    for (let round = 0; round < ROUNDS; round++)
      for (const c of COMMANDS)
        keep(
          await elevenlabs(llm, id, c).catch((e: Error) => ({
            via: `elevenlabs ${llm}`,
            said: c.said,
            want: c.tool,
            error: e.message,
          })),
        );
  } finally {
    await eleven(`/v1/convai/agents/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
}
console.log("\nvia                                right  tool median  speech median");
for (const via of new Set(results.map((r) => r.via))) {
  const rs = results.filter((r) => r.via === via);
  const right = rs.filter((r) => r.tool === r.want).length;
  const called = median(rs.flatMap((r) => (r.called === undefined ? [] : [r.called])));
  const spoke = median(rs.flatMap((r) => (r.spoke === undefined ? [] : [r.spoke])));
  console.log(
    `${via.padEnd(34)} ${`${String(right)}/${String(rs.length)}`.padStart(6)} ${String(Math.round(called ?? Number.NaN)).padStart(8)} ms ${String(Math.round(spoke ?? Number.NaN)).padStart(10)} ms`,
  );
}
mkdirSync(RUNS, { recursive: true });
writeFileSync(
  path.join(RUNS, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
  JSON.stringify(results, null, 2),
);
