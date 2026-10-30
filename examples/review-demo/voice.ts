import type { Plugin } from "vite";

/*
 * The agent cursor's voice for the workshop, on the dev server only: `POST /__voice` with
 * `{ text, voice }` sends back the words as speech from ElevenLabs. The key stays on the
 * server, in `ELEVENLABS_API_KEY`; the page never sees it. Without a key the route answers
 * 503, and the workshop shows the words alone. Each line is kept in memory, so a walk says
 * it again at once.
 */

const MODEL = "eleven_v4";

export function voice(): Plugin {
  const kept = new Map<string, Promise<Uint8Array>>();
  return {
    name: "workshop-voice",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__voice", (req, res) => {
        const key = process.env["ELEVENLABS_API_KEY"];
        if (req.method !== "POST" || key === undefined || key === "") {
          res.statusCode = key === undefined || key === "" ? 503 : 405;
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
            audio = fetch(
              `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
              {
                method: "POST",
                headers: { "xi-api-key": key, "Content-Type": "application/json" },
                body: JSON.stringify({ text, model_id: MODEL }),
              },
            ).then(async (r) => {
              if (!r.ok) throw new Error(`ElevenLabs ${String(r.status)}: ${await r.text()}`);
              return new Uint8Array(await r.arrayBuffer());
            });
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
