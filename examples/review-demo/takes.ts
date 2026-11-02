import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/*
 * Where the workshop's exchanges go for the hearing evals, on the dev server only.
 * `POST /__timing` with one exchange's trace adds it to evals/hearing/live.jsonl.
 * `POST /__take`, a form with `take` (the trace and what the agent got) and `audio` (his
 * words), saves one case under evals/hearing/takes/<id>/. Both stay out of git: they hold his
 * voice and his real use.
 */

const HEARING = fileURLToPath(new URL("../../evals/hearing/", import.meta.url));

const bodyOf = (req: import("node:http").IncomingMessage) =>
  new Promise<Buffer>((done, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => done(Buffer.concat(chunks)));
    req.on("error", fail);
  });

export function takes(): Plugin {
  return {
    name: "workshop-takes",
    apply: "serve",
    configureServer(server) {
      const log = server.config.logger;
      server.middlewares.use("/__timing", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        void bodyOf(req)
          .then(async (body) => {
            const trace = JSON.parse(body.toString()) as object;
            await mkdir(HEARING, { recursive: true });
            await appendFile(
              join(HEARING, "live.jsonl"),
              `${JSON.stringify({ ...trace, on: new Date().toISOString() })}\n`,
            );
          })
          .catch((error: unknown) => log.warn(`workshop timing: ${String(error)}`))
          .finally(() => res.end());
      });
      server.middlewares.use("/__take", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        void bodyOf(req)
          .then(async (body) => {
            const form = await new Response(new Uint8Array(body), {
              headers: { "Content-Type": req.headers["content-type"] ?? "" },
            }).formData();
            const sent = form.get("take");
            if (typeof sent !== "string") throw new Error("No take in the form");
            const take = JSON.parse(sent) as { trace: { id: string } };
            const id = take.trace.id.replace(/[^\w-]/g, "");
            const dir = join(HEARING, "takes", id);
            await mkdir(dir, { recursive: true });
            await writeFile(
              join(dir, "take.json"),
              `${JSON.stringify({ ...take, on: new Date().toISOString() }, null, 1)}\n`,
            );
            const audio = form.get("audio");
            if (audio instanceof Blob)
              await writeFile(join(dir, "audio.webm"), new Uint8Array(await audio.arrayBuffer()));
            log.info(`workshop take: saved ${id}`);
          })
          .catch((error: unknown) => {
            log.warn(`workshop take: ${String(error)}`);
            res.statusCode = 500;
          })
          .finally(() => res.end());
      });
    },
  };
}
