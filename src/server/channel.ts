import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

/*
 * The channel's four routes for one app's files, as plain Node, so the Vite plugin
 * (src/vite.ts) and `blueline serve` (src/server/serve.ts) answer the page the same way.
 * Who may write is the caller's rule: the plugin takes the page of its own host, the server
 * the app's registered origins. Node loads this file from the plugin's source, so its
 * imports name their `.ts` files.
 */

/** Where one app's channel keeps its lines and files. */
export interface ChannelFiles {
  /** The JSON lines file the notes go to. */
  readonly feedback: string;
  /** The JSON file the agent answers in. */
  readonly status: string;
  /** The folder pasted screenshots go to. */
  readonly images: string;
  /** The JSON file each agent's listener says it is there in (bin/listen.ts). */
  readonly listening: string;
}

export type ChannelRoute = "feedback" | "status" | "images" | "listening";

/** Whether a request may write to the channel. */
export type Allowed = (request: IncomingMessage) => boolean;

/** The screenshot types the page may paste, by their file ending. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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

function end(response: ServerResponse, status: number) {
  response.statusCode = status;
  response.end();
}

/**
 * Answers one request to `route`. `rest` is the path after the route, as `/<name>` for an
 * image to show.
 */
export function answer(
  files: ChannelFiles,
  allowed: Allowed,
  route: ChannelRoute,
  rest: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  switch (route) {
    case "feedback":
      return note(files, allowed, request, response);
    case "images":
      return request.method === "GET"
        ? showImage(files, rest, response)
        : keepImage(files, allowed, request, response);
    case "status":
      return json(files.status, response);
    case "listening":
      return json(files.listening, response);
  }
}

function note(
  files: ChannelFiles,
  allowed: Allowed,
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") return end(response, 405);
  if (!allowed(request)) return end(response, 403);
  if (!isJson(request.headers["content-type"])) return end(response, 415);
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const line = stamped(Buffer.concat(chunks).toString("utf8"), randomUUID());
    if (line === undefined) return end(response, 400);
    mkdir(path.dirname(files.feedback), { recursive: true })
      .then(() => appendFile(files.feedback, `${line}\n`))
      .then(
        () => end(response, 204),
        () => end(response, 500),
      );
  });
}

// GET /<name> shows a screenshot the page kept.
function showImage(files: ChannelFiles, rest: string, response: ServerResponse) {
  const name = rest.replace(/^\//, "");
  const type = IMAGE_TYPES[path.extname(name).slice(1)];
  if (!/^[\w-]+\.\w+$/.test(name) || type === undefined) return end(response, 404);
  readFile(path.join(files.images, name)).then(
    (body) => {
      response.setHeader("content-type", type);
      response.end(body);
    },
    () => end(response, 404),
  );
}

function keepImage(
  files: ChannelFiles,
  allowed: Allowed,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const ending = Object.keys(IMAGE_TYPES).find(
    (k) => IMAGE_TYPES[k] === request.headers["content-type"],
  );
  if (request.method !== "POST") return end(response, 405);
  if (!allowed(request)) return end(response, 403);
  if (ending === undefined) return end(response, 415);
  const chunks: Buffer[] = [];
  let size = 0;
  request.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size <= MAX_IMAGE_BYTES) chunks.push(chunk);
  });
  request.on("end", () => {
    if (size > MAX_IMAGE_BYTES) return end(response, 413);
    const name = `${randomUUID()}.${ending}`;
    const file = path.join(files.images, name);
    mkdir(files.images, { recursive: true })
      .then(() => writeFile(file, Buffer.concat(chunks)))
      .then(
        () => {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ name, file }));
        },
        () => end(response, 500),
      );
  });
}

function json(file: string, response: ServerResponse) {
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  readFile(file, "utf8").then(
    (body) => response.end(body),
    () => response.end("{}"),
  );
}
