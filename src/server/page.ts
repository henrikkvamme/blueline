import type { IncomingMessage, ServerResponse } from "node:http";
import { request as send } from "node:http";
import type { ChannelRoute } from "./channel.ts";

/*
 * The page's side of a dev server in front of `blueline serve`: the Vite plugin
 * (src/vite.ts) and `blueline dev` (src/server/dev.ts) check that a request comes from the
 * dev server's own page, then send it on to the server as a tool's.
 */

/** Where the page posts notes and reads replies. The page's copy is in io/routes.ts: Node
 * loads it with the app's Vite config, so it imports nothing of the page. A test keeps
 * the two the same. */
export const ROUTES = {
  feedback: "/__devtools/feedback",
  status: "/__devtools/status",
  images: "/__devtools/images",
  listening: "/__devtools/listening",
};
export type Routes = typeof ROUTES;
export const CHANNEL_ROUTES: readonly ChannelRoute[] = [
  "feedback",
  "status",
  "images",
  "listening",
];
/** The overlay from the server, and the module that mounts it on the page. */
export const OVERLAY = "/__devtools/overlay.js";
export const TAG = "/__devtools/tag.js";

/**
 * Whether a request comes from the dev server's own page. A browser names the page's origin
 * on each POST, so another site cannot put a note in the file the agent acts on. A request
 * with no origin is not from a browser page, as the agent's own tools are. The dev server
 * checks the request's host first: Vite by `server.allowedHosts`, `blueline dev` by its own.
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

/** The headers of one connection, which a request forwarded on another does not keep. */
const OWN_HEADERS = ["host", "origin", "connection", "keep-alive", "upgrade", "referer"];

/**
 * Sends a page's request on to the server as a tool's: the caller checked the page, so the
 * request goes with no `Origin`.
 */
export function forward(
  port: number,
  target: string,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !OWN_HEADERS.includes(name)),
  );
  const sent = send(
    { host: "127.0.0.1", port, path: target, method: request.method, headers },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
      // An answer cut short ends the page's answer too, so the page does not wait on it.
      answer.once("close", () => {
        if (!answer.complete) response.destroy();
      });
    },
  );
  sent.on("error", () => {
    if (response.headersSent) return void response.destroy();
    response.statusCode = 502;
    response.end();
  });
  // A page that goes stops the server's answer, as an event stream that never ends.
  response.once("close", () => sent.destroy());
  request.pipe(sent);
}

export const refuse = (response: ServerResponse, status: number, why?: string) => {
  response.statusCode = status;
  if (why !== undefined) response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(why);
};
