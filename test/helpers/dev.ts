import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type InlineConfig, type ViteDevServer } from "vite";
import { expect, vi } from "vitest";
import { serve } from "../../src/server/serve";
import { devtoolsChannel, ROUTES, type ChannelOptions } from "../../src/vite";

/** A new folder, by its real path, as the server names roots. */
export const folder = (name: string) =>
  realpathSync(mkdtempSync(path.join(tmpdir(), `blueline-${name}-`)));

/** `blueline serve` on a free port, with its own state folder. */
export async function startServe(
  options: { port?: number; state?: string; overlay?: string } = {},
) {
  const state = options.state ?? folder("state");
  const served = await serve({ port: options.port ?? 0, state, ...options });
  if (served.kind !== "started") throw new Error("Another server answered.");
  return {
    port: served.port,
    state,
    url: `http://127.0.0.1:${String(served.port)}`,
    close: served.close,
  };
}

/** A Vite dev server with the plugin, for `blueline serve` at `place`, listening. */
export async function startVite(
  root: string,
  place: { port: number; state: string },
  options: ChannelOptions = {},
  config: InlineConfig = {},
): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    ...config,
    plugins: [devtoolsChannel({ serve: place, ...options })],
    server: { port: 0, host: "127.0.0.1", ws: false, ...config.server },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== "object" || address === null) throw new Error("The server has no port.");
  const scheme = config.server?.https === undefined ? "http" : "https";
  return { server, url: `${scheme}://127.0.0.1:${String(address.port)}` };
}

/** Waits until the plugin has its registration: the page's routes answer. */
export async function registered(url: string, routes = ROUTES) {
  await vi.waitFor(async () => expect((await fetch(`${url}${routes.status}`)).status).toBe(200), {
    timeout: 5000,
  });
}
