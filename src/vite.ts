import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

/*
 * The channel between the dev tools and the coding agent, through the dev server. A note
 * the reviewer sends is one JSON line in `feedback`, which the agent watches; the server
 * adds the line's format version and its ID (`stamped`). The agent
 * answers in `status`, a JSON object by note ID, which the page reads while a note waits.
 * A screenshot the reviewer pastes goes to `images` first; the note then names its file.
 * Each agent's listener says it is there in `listening`, so the page knows a note is read.
 * The channel is for development only: a build has no dev tools.
 *
 * An app that loads Blueline from its source, as a linked package, would also load
 * Blueline's own install of React beside the app's, and two copies of React on one page
 * break its hooks. The plugin has the app's React serve both, in development and in a build,
 * where `variants()` stays.
 */

export interface ChannelOptions {
  /** The JSON lines file the notes go to. */
  readonly feedback: string;
  /** The JSON file the agent answers in. */
  readonly status: string;
  /** The folder pasted screenshots go to: by default `images` beside `feedback`. */
  readonly images?: string;
  /** The JSON file each agent's listener says it is there in: by default beside `feedback`,
   * as `blueline listen` writes it (bin/listen.ts). */
  readonly listening?: string;
  /** Where the page posts and reads; the defaults match the dev tools'. */
  readonly routes?: Routes;
}

/** Where the page posts notes and reads replies. The page's copy is in io/routes.ts: this
 * file has no relative imports, as Node loads it with the app's Vite config. A test keeps
 * the two the same. */
export const ROUTES = {
  feedback: "/__devtools/feedback",
  status: "/__devtools/status",
  images: "/__devtools/images",
  listening: "/__devtools/listening",
};
export type Routes = typeof ROUTES;

/** The screenshot types the page may paste, by their file ending. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** The packages that hold React's state, each with its subpaths, as the JSX runtimes. */
const ONE_COPY = ["react", "react-dom"];

/** Whether the app at `root` has its own React to share. */
export function hasReact(root: string): boolean {
  try {
    createRequire(path.join(root, "package.json")).resolve("react/package.json");
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a write comes from the dev server's own page. A browser names the page's origin
 * on each POST, so another site cannot put a note in the file the agent acts on. A request
 * with no origin is not from a browser page, as the agent's own tools are.
 */
export function fromPage(headers: {
  readonly origin?: string | undefined;
  readonly host?: string | undefined;
}): boolean {
  if (headers.origin === undefined) return true;
  try {
    return new URL(headers.origin).host === headers.host;
  } catch {
    return false;
  }
}

/** The version of the feedback file's lines. A reader takes a line with no `v` as version 1. */
export const LINE_FORMAT = 1;

/**
 * A line as the feedback file keeps it: the page's JSON object with the format version and
 * the line's own ID, which readers claim it by (bin/wire.ts). The server sets both, so a page
 * cannot give two lines one ID. Undefined when the body is not a JSON object.
 */
export function stamped(body: string, line: string): string | undefined {
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    return JSON.stringify({ ...value, v: LINE_FORMAT, line });
  } catch {
    return undefined;
  }
}

/** Whether a body is JSON by its type: a plain text body needs no CORS check first. */
export const isJson = (type: string | undefined): boolean =>
  type?.split(";")[0]?.trim().toLowerCase() === "application/json";

export function devtoolsChannel(options: ChannelOptions): Plugin {
  const routes = options.routes ?? ROUTES;
  const images = path.resolve(
    options.images ?? path.join(path.dirname(options.feedback), "images"),
  );
  return {
    name: "blueline:channel",
    config: (config) =>
      hasReact(path.resolve(config.root ?? ".")) ? { resolve: { dedupe: ONE_COPY } } : {},
    // Only the dev server has the channel.
    configureServer(server) {
      server.middlewares.use(routes.feedback, (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        if (!fromPage(request.headers) || !isJson(request.headers["content-type"])) {
          response.statusCode = fromPage(request.headers) ? 415 : 403;
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          const line = stamped(Buffer.concat(chunks).toString("utf8"), randomUUID());
          if (line === undefined) {
            response.statusCode = 400;
            response.end();
            return;
          }
          mkdir(path.dirname(options.feedback), { recursive: true })
            .then(() => appendFile(options.feedback, `${line}\n`))
            .then(
              () => {
                response.statusCode = 204;
                response.end();
              },
              () => {
                response.statusCode = 500;
                response.end();
              },
            );
        });
      });
      // POST a screenshot to keep it; GET /<name> to show it.
      server.middlewares.use(routes.images, (request, response) => {
        if (request.method === "GET") {
          const name = (request.url ?? "").replace(/^\//, "");
          const type = IMAGE_TYPES[path.extname(name).slice(1)];
          if (!/^[\w-]+\.\w+$/.test(name) || type === undefined) {
            response.statusCode = 404;
            response.end();
            return;
          }
          readFile(path.join(images, name)).then(
            (body) => {
              response.setHeader("content-type", type);
              response.end(body);
            },
            () => {
              response.statusCode = 404;
              response.end();
            },
          );
          return;
        }
        const ending = Object.keys(IMAGE_TYPES).find(
          (k) => IMAGE_TYPES[k] === request.headers["content-type"],
        );
        if (request.method !== "POST" || ending === undefined) {
          response.statusCode = request.method === "POST" ? 415 : 405;
          response.end();
          return;
        }
        if (!fromPage(request.headers)) {
          response.statusCode = 403;
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        request.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_IMAGE_BYTES) chunks.push(chunk);
        });
        request.on("end", () => {
          if (size > MAX_IMAGE_BYTES) {
            response.statusCode = 413;
            response.end();
            return;
          }
          const name = `${randomUUID()}.${ending}`;
          const file = path.join(images, name);
          mkdir(images, { recursive: true })
            .then(() => writeFile(file, Buffer.concat(chunks)))
            .then(
              () => {
                response.setHeader("content-type", "application/json");
                response.end(JSON.stringify({ name, file }));
              },
              () => {
                response.statusCode = 500;
                response.end();
              },
            );
        });
      });
      const json = (route: string, file: string) =>
        server.middlewares.use(route, (_request, response) => {
          response.setHeader("content-type", "application/json");
          response.setHeader("cache-control", "no-store");
          readFile(file, "utf8").then(
            (body) => response.end(body),
            () => response.end("{}"),
          );
        });
      json(routes.status, options.status);
      json(routes.listening, options.listening ?? `${options.feedback}.listening.json`);
    },
  };
}
