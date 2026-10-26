import type { IncomingMessage, ServerResponse } from "node:http";
import { request as send } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import type { GivenFiles } from "./server/apps.ts";
import type { ChannelRoute } from "./server/channel.ts";
import { holdRegistration, placeOf, type Holding, type Place } from "./server/start.ts";

export { isJson, LINE_FORMAT, stamped } from "./server/channel.ts";

/*
 * The channel between the dev tools and the coding agent, through the dev server to
 * `blueline serve`, which keeps every app's notes on the machine (ADR 0003). When the dev
 * server listens, the plugin starts the server if none runs and registers the app's root,
 * and the page's routes go on to the app's channel there. A note the reviewer sends is one
 * JSON line in the app's feedback file, which the agent watches; the agent answers in its
 * status file. The plugin also puts the overlay on each page, unless the app mounts its own.
 * The channel is for development only: a build has no dev tools.
 *
 * An app that loads Blueline from its source, as a linked package, would also load
 * Blueline's own install of React beside the app's, and two copies of React on one page
 * break its hooks. The plugin has the app's React serve both, in development and in a build,
 * where `variants()` stays.
 */

export interface ChannelOptions {
  /** The JSON lines file the notes go to: by default `.blueline/feedback.jsonl` in the root. */
  readonly feedback?: string;
  /** The JSON file the agent answers in: by default `.blueline/status.json` in the root. */
  readonly status?: string;
  /** The folder pasted screenshots go to: by default `images` beside `feedback`. */
  readonly images?: string;
  /** The JSON file each agent's listener says it is there in: by default beside `feedback`,
   * as `blueline listen` writes it (bin/listen.ts). */
  readonly listening?: string;
  /** Where the page posts and reads; the defaults match the dev tools'. */
  readonly routes?: Routes;
  /** Puts the overlay on each page; `false` for an app that mounts its own. */
  readonly overlay?: boolean;
  /** The page's origin. Vite in middleware mode has no address, so it needs this. */
  readonly origin?: string;
  /** Where `blueline serve` runs: by default `BLUELINE_PORT` or 4399, and its state folder. */
  readonly serve?: Partial<Place>;
}

/** Where the page posts notes and reads replies. The page's copy is in io/routes.ts: Node
 * loads this file with the app's Vite config, so it imports nothing of the page. A test keeps
 * the two the same. */
export const ROUTES = {
  feedback: "/__devtools/feedback",
  status: "/__devtools/status",
  images: "/__devtools/images",
  listening: "/__devtools/listening",
};
export type Routes = typeof ROUTES;
const CHANNEL_ROUTES: readonly ChannelRoute[] = ["feedback", "status", "images", "listening"];
/** The overlay from the server, and the module that mounts it on the page. */
export const OVERLAY = "/__devtools/overlay.js";
export const TAG = "/__devtools/tag.js";

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
 * Whether a request comes from the dev server's own page. A browser names the page's origin
 * on each POST, so another site cannot put a note in the file the agent acts on. A request
 * with no origin is not from a browser page, as the agent's own tools are. Vite checks the
 * request's host before the plugin's routes (`server.allowedHosts`).
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
 * Sends a page's request on to the server as a tool's: the plugin checked the page, so the
 * request goes with no `Origin`.
 */
function forward(port: number, target: string, request: IncomingMessage, response: ServerResponse) {
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
  request.pipe(sent);
}

const refuse = (response: ServerResponse, status: number, why?: string) => {
  response.statusCode = status;
  if (why !== undefined) response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(why);
};

/** The module that mounts the overlay on the page, on the page's routes. */
const tagOf = (routes: Routes) =>
  `import { mountPage } from "${OVERLAY}";\nmountPage(${JSON.stringify({ storageKey: "blueline", routes })});\n`;

export function devtoolsChannel(options: ChannelOptions = {}): Plugin {
  const routes = options.routes ?? ROUTES;
  const given: GivenFiles = Object.fromEntries(
    (["feedback", "status", "images", "listening"] as const).flatMap((key) => {
      const file = options[key];
      return file === undefined ? [] : [[key, file]];
    }),
  );
  let holding: Holding | undefined;
  let waiting = "Blueline is not registered with its server yet.";
  return {
    name: "blueline:channel",
    config: (config) =>
      hasReact(path.resolve(config.root ?? ".")) ? { resolve: { dedupe: ONE_COPY } } : {},
    // Only the dev server has the channel.
    configureServer(server) {
      const place = { ...placeOf(process.env), ...options.serve };
      const register = (origin: string) => {
        holding = holdRegistration({
          place,
          root: server.config.root,
          origin,
          files: given,
          warn: (message) => server.config.logger.warn(message),
        });
      };
      if (server.config.server.middlewareMode) {
        if (options.origin !== undefined) register(options.origin);
        else {
          waiting =
            "Blueline needs the page's origin in middleware mode: devtoolsChannel({ origin }).";
          server.config.logger.warn(waiting);
        }
      } else
        server.httpServer?.once("listening", () => {
          const address = server.httpServer?.address();
          const port = typeof address === "object" && address !== null ? address.port : 0;
          const scheme = server.config.server.https ? "https" : "http";
          register(options.origin ?? `${scheme}://localhost:${String(port)}`);
        });
      server.httpServer?.once("close", () => holding?.stop());

      const via = (to: (base: string, rest: string) => string) =>
        function blueline(request: IncomingMessage, response: ServerResponse) {
          if (!fromPage(request.headers)) return refuse(response, 403);
          const app = holding?.app();
          if (app === undefined) return refuse(response, 503, waiting);
          const rest = request.url === undefined || request.url === "/" ? "" : request.url;
          forward(place.port, to(app.base, rest), request, response);
        };
      for (const route of CHANNEL_ROUTES)
        server.middlewares.use(
          routes[route],
          via((base, rest) => `${base}${route}${rest}`),
        );
      server.middlewares.use(
        OVERLAY,
        via(() => "/blueline/overlay.js"),
      );
      server.middlewares.use(TAG, (_request, response) => {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(tagOf(routes));
      });
    },
    buildEnd: () => holding?.stop(),
    transformIndexHtml: (_html, context) =>
      context.server === undefined || options.overlay === false
        ? undefined
        : [{ tag: "script", attrs: { type: "module", src: TAG }, injectTo: "head" }],
  };
}
