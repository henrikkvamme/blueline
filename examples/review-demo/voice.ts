import type { Plugin } from "vite";

/*
 * The agent cursor's voice and ears for the workshop, on the dev server only, both from
 * ElevenLabs. `POST /__voice` with `{ text, voice }` sends back the words as speech; each
 * line is kept in memory, so a walk says it again at once. `POST /__hear` with the audio of
 * the reviewer's words sends back `{ text, words }`, each word with its time. The key stays on the server, in
 * `ELEVENLABS_API_KEY`; the page never sees it. Without a key both routes answer 503, and the
 * workshop shows the words alone.
 */

const MODEL = "eleven_v4";
const EARS = "scribe_v2";

/**
 * The plan runs 3 requests at a time. Speech takes 2 of them, one after another as they
 * free, so the reviewer's own words always find room.
 */
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

const keyOf = () => {
  const key = process.env["ELEVENLABS_API_KEY"];
  return key === undefined || key === "" ? undefined : key;
};

export function voice(): Plugin {
  const kept = new Map<string, Promise<Uint8Array>>();
  const speak = limit(SPEAKING);
  return {
    name: "workshop-voice",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__hear", (req, res) => {
        const key = keyOf();
        if (req.method !== "POST" || key === undefined) {
          res.statusCode = key === undefined ? 503 : 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const form = new FormData();
          form.append("model_id", EARS);
          form.append(
            "file",
            new Blob([Buffer.concat(chunks)], {
              type: req.headers["content-type"] ?? "audio/webm",
            }),
            "words.webm",
          );
          fetch("https://api.elevenlabs.io/v1/speech-to-text", {
            method: "POST",
            headers: { "xi-api-key": key },
            body: form,
          })
            .then(async (r) => {
              if (!r.ok) throw new Error(`ElevenLabs ${String(r.status)}: ${await r.text()}`);
              const { text, words } = (await r.json()) as {
                text: string;
                words?: readonly { text: string; start: number; end: number; type: string }[];
              };
              // Each word with its time in the audio, in s, so the page can tell what he
              // pointed at while he said it.
              const timed = (words ?? [])
                .filter((w) => w.type === "word")
                .map(({ text, start, end }) => ({ text, start, end }));
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ text, words: timed }));
            })
            .catch((error: unknown) => {
              server.config.logger.warn(String(error));
              res.statusCode = 502;
              res.end();
            });
        });
      });
      server.middlewares.use("/__voice", (req, res) => {
        const key = keyOf();
        if (req.method !== "POST" || key === undefined) {
          res.statusCode = key === undefined ? 503 : 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          const { text, voice } = JSON.parse(body) as { text: string; voice: string };
          const id = `${voice}\n${text}`;
          let audio = kept.get(id);
          if (audio === undefined) {
            audio = speak(() =>
              fetch(
                `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
                {
                  method: "POST",
                  headers: { "xi-api-key": key, "Content-Type": "application/json" },
                  body: JSON.stringify({ text, model_id: MODEL }),
                },
              ).then(async (r) => {
                if (!r.ok) throw new Error(`ElevenLabs ${String(r.status)}: ${await r.text()}`);
                return new Uint8Array(await r.arrayBuffer());
              }),
            );
            kept.set(id, audio);
            audio.catch(() => kept.delete(id));
          }
          audio.then(
            (bytes) => {
              res.setHeader("Content-Type", "audio/mpeg");
              res.end(bytes);
            },
            (error: unknown) => {
              server.config.logger.warn(String(error));
              res.statusCode = 502;
              res.end();
            },
          );
        });
      });
    },
  };
}
