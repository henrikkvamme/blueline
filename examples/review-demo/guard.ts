import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import { fromPage } from "@henrikkvamme/blueline/vite";

/*
 * The demo's own routes start an agent that writes code, spend the API keys and keep what he
 * said. Only the page itself, or a tool on the machine, may call them: a page on another site
 * could otherwise post to them from his browser. The browser says where a request comes from
 * in `Sec-Fetch-Site`, also behind a proxy that changes the host; a tool sends no such header
 * and no `Origin`.
 */

const ROUTES = ["/__agent", "/__take", "/__timing", "/__realtime", "/__voice"];

/** Whether the request comes from the page's own origin, or from a tool. */
export function ownRequest(request: Pick<IncomingMessage, "headers">): boolean {
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined) return site === "same-origin" || site === "none";
  return fromPage({ origin: request.headers.origin, host: request.headers.host });
}

export function guard(): Plugin {
  return {
    name: "workshop-guard",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0] ?? "";
        const ours = ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
        if (!ours || ownRequest(request)) return next();
        response.statusCode = 403;
        response.end();
      });
    },
  };
}
