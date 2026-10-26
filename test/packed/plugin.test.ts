import { execFile } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, describe, expect, it, vi } from "vitest";
import { folder } from "../helpers/dev";

/*
 * The plugin and the command from the built package, run from a folder of their own: the
 * plugin starts the package's own `blueline serve`, and a page's note lands in the app.
 */

const DIST = path.join(import.meta.dirname, "..", "..", "dist");
const run = promisify(execFile);

async function freePort() {
  const server = createNetServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise((done) => server.close(done));
  if (typeof address !== "object" || address === null) throw new Error("No port");
  return address.port;
}

describe("the built plugin", () => {
  const state = folder("packed-state");
  let port = 0;
  let server: ViteDevServer | undefined;

  afterAll(async () => {
    await server?.close();
    await run(process.execPath, [path.join(DIST, "bin", "blueline.js"), "serve", "stop"], {
      cwd: state,
      env: { ...process.env, BLUELINE_PORT: String(port), BLUELINE_STATE: state },
    });
    rmSync(state, { recursive: true, force: true });
  });

  it("starts the package's server and takes a page's note", async () => {
    port = await freePort();
    const root = folder("packed-app");
    const plugin: typeof import("../../src/vite") = await import(path.join(DIST, "vite.js"));
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true },
      plugins: [plugin.devtoolsChannel({ serve: { port, state } })],
      server: { port: 0, host: "127.0.0.1", ws: false },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (typeof address !== "object" || address === null) throw new Error("No port");
    const url = `http://127.0.0.1:${String(address.port)}`;
    await vi.waitFor(
      async () => expect((await fetch(`${url}${plugin.ROUTES.status}`)).status).toBe(200),
      { timeout: 8000 },
    );
    const health = (await (
      await fetch(`http://127.0.0.1:${String(port)}/blueline/health`)
    ).json()) as {
      pid: number;
    };
    expect(health.pid).not.toBe(process.pid);
    expect(readFileSync(path.join(state, "serve.log"), "utf8")).toContain("serves every app");
    const sent = await fetch(`${url}${plugin.ROUTES.feedback}`, {
      method: "POST",
      body: '{"kind":"note"}',
      headers: { "content-type": "application/json", origin: url },
    });
    expect(sent.status).toBe(204);
    expect(readFileSync(path.join(root, ".blueline", "feedback.jsonl"), "utf8")).toContain(
      '"note"',
    );
    const overlay = await fetch(`${url}${plugin.OVERLAY}`);
    expect(overlay.status).toBe(200);
    expect(await overlay.text()).toContain("mountPage");
    writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
    expect(await (await fetch(`${url}/`)).text()).toContain(plugin.TAG);
  });
});
