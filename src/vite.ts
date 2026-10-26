import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import { answer, type ChannelFiles, type ChannelRoute } from "./server/channel.ts";

export { isJson, LINE_FORMAT, stamped } from "./server/channel.ts";

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

export function devtoolsChannel(options: ChannelOptions): Plugin {
  const routes = options.routes ?? ROUTES;
  const files: ChannelFiles = {
    feedback: options.feedback,
    status: options.status,
    images: path.resolve(options.images ?? path.join(path.dirname(options.feedback), "images")),
    listening: options.listening ?? `${options.feedback}.listening.json`,
  };
  return {
    name: "blueline:channel",
    config: (config) =>
      hasReact(path.resolve(config.root ?? ".")) ? { resolve: { dedupe: ONE_COPY } } : {},
    // Only the dev server has the channel.
    configureServer(server) {
      for (const route of CHANNEL_ROUTES)
        server.middlewares.use(routes[route], (request, response) =>
          answer(files, (r) => fromPage(r.headers), route, request.url ?? "", request, response),
        );
    },
  };
}
