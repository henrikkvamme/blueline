import type { Plugin } from "vite";

/*
 * The agent cursor's voice for the workshop, on the dev server only. The voice is OpenAI's, as
 * the fast tier's is (ADR 0008), so Blueline speaks with one voice. `GET /__voice?text=&voice=`
 * sends back the words as speech, streamed as OpenAI makes it, so the page plays it from the
 * first bytes; `POST /__voice/ahead` with `{ text, voice }` starts a line before the walk comes
 * to it. Each line is kept in memory for a time, so a walk says it again at once. The key stays
 * on the server, in `OPENAI_API_KEY`; the page never sees it. Without the key the routes answer
 * 503, and the workshop shows the words alone.
 */

const MODEL = "gpt-4o-mini-tts";

/** Speech runs 2 requests at a time, one after another as they free. */
const SPEAKING = 2;

function limit(most: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= most) await new Promise<void>((go) => waiting.push(go));
    running++;
    try {
      return await work();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

const speechKey = () => {
  const key = process.env["OPENAI_API_KEY"];
  return key === undefined || key === "" ? undefined : key;
};

/** The speech kept in memory: at most this many bytes, each line for at most this long. */
const KEEP = { bytes: 32 * 1024 * 1024, ms: 30 * 60_000 } as const;

/** A line of speech: its bytes so far, and who waits for more. */
export interface Line {
  readonly chunks: Uint8Array[];
  /** When it was asked for. */
  readonly made: number;
  size: number;
  done: boolean;
  failed: boolean;
  readonly wake: Set<() => void>;
}

const kept = new Map<string, Line>();
const speak = limit(SPEAKING);

/** Drops the oldest lines, first in first out, until the rest are young and small enough. A
 * page that plays a dropped line still has it. */
export function prune(lines: Map<string, Line>, now: number, keep: typeof KEEP = KEEP) {
  let bytes = 0;
  for (const line of lines.values()) bytes += line.size;
  for (const [id, line] of lines) {
    if (bytes <= keep.bytes && now - line.made < keep.ms) break;
    lines.delete(id);
    bytes -= line.size;
  }
}

/** Starts the line, or finds it, and keeps its bytes as they come. */
function lineOf(text: string, voice: string, key: string, warn: (why: string) => void) {
  const id = `${voice}\n${text}`;
  prune(kept, Date.now());
  const found = kept.get(id);
  if (found !== undefined) return found;
  const line: Line = {
    chunks: [],
    made: Date.now(),
    size: 0,
    done: false,
    failed: false,
    wake: new Set(),
  };
  kept.set(id, line);
  const ping = () => {
    for (const wake of line.wake) wake();
  };
  speak(async () => {
    // Streamed: the first bytes came in about 1.6 s on fry, the whole line in about 2.3 s.
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        voice,
        input: text,
        instructions: "Speak calmly and evenly, as a colleague beside him.",
        response_format: "mp3",
      }),
    });
    if (!r.ok || r.body === null) throw new Error(`OpenAI ${String(r.status)}: ${await r.text()}`);
    for await (const chunk of r.body) {
      line.chunks.push(chunk);
      line.size += chunk.byteLength;
      ping();
    }
  }).then(
    () => {
      line.done = true;
      prune(kept, Date.now());
      ping();
    },
    (error: unknown) => {
      warn(String(error));
      line.failed = true;
      if (kept.get(id) === line) kept.delete(id);
      ping();
    },
  );
  return line;
}

/**
 * Starts a line of speech before the page asks for it: the agent calls this as soon as the
 * model has written a walk's first line, while it still writes the rest.
 */
export function speakAhead(text: string, voice: string, warn: (why: string) => void) {
  const key = speechKey();
  if (key !== undefined) lineOf(text, voice, key, warn);
}

export function voice(): Plugin {
  return {
    name: "workshop-voice",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("close", () => kept.clear());
      // Starts a line ahead, so it plays at once when the walk comes to it.
      server.middlewares.use("/__voice/ahead", (req, res) => {
        const key = speechKey();
        if (req.method !== "POST" || key === undefined) {
          res.statusCode = key === undefined ? 503 : 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          const { text, voice } = JSON.parse(body) as { text: string; voice: string };
          lineOf(text, voice, key, (why) => server.config.logger.warn(why));
          res.statusCode = 204;
          res.end();
        });
      });
      // The line as speech, sent on as it comes, so the page plays it from the first bytes.
      server.middlewares.use("/__voice", (req, res) => {
        const key = speechKey();
        const query = new URL(req.url ?? "/", "http://here").searchParams;
        const text = query.get("text");
        const voice = query.get("voice");
        if (req.method !== "GET" || key === undefined || text === null || voice === null) {
          res.statusCode = key === undefined ? 503 : 400;
          res.end();
          return;
        }
        const line = lineOf(text, voice, key, (why) => server.config.logger.warn(why));
        let sent = 0;
        let started = false;
        const go = () => {
          if (line.failed && !started) {
            res.statusCode = 502;
            res.end();
          } else {
            if (!started && (line.chunks.length > 0 || line.done)) {
              res.setHeader("Content-Type", "audio/mpeg");
              res.setHeader("Cache-Control", "no-store");
              started = true;
            }
            while (sent < line.chunks.length) res.write(line.chunks[sent++]);
            if (!line.done && !line.failed) return;
            res.end();
          }
          line.wake.delete(go);
        };
        line.wake.add(go);
        res.on("close", () => line.wake.delete(go));
        go();
      });
    },
  };
}
