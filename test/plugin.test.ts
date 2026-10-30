import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { createServer as createHttpServer, request } from "node:http";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "../src/server/apps";
import pkg from "../package.json" with { type: "json" };
import { devtoolsChannel, OVERLAY, ROUTES, TAG } from "../src/vite";
import { folder, registered, startServe, startVite } from "./helpers/dev";

/*
 * The Vite plugin on `blueline serve`: it registers the dev server, sends the page's routes
 * on, puts the overlay on the page, and registers again when the server restarts.
 */

const overlay = path.join(folder("overlay"), "index.js");
writeFileSync(overlay, "export const mountPage = () => undefined;\n");

let serve: Awaited<ReturnType<typeof startServe>>;
const servers: ViteDevServer[] = [];

beforeAll(async () => {
  serve = await startServe({ overlay });
});
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});
afterAll(() => serve.close());

async function vite(
  ...args: Parameters<typeof startVite> extends [unknown, unknown, ...infer R] ? R : never
) {
  const root = folder("app");
  const started = await startVite(root, serve, ...args);
  servers.push(started.server);
  return { root, ...started };
}

/** A request with the headers a fetch does not let a test set, as `Host`. */
function raw(
  url: string,
  pathname: string,
  headers: Record<string, string>,
  method = "GET",
  body = "",
) {
  return new Promise<{ status: number; headers: Record<string, unknown>; text: string }>(
    (done, fail) => {
      const sent = request(`${url}${pathname}`, { method, headers }, (reply) => {
        let text = "";
        reply.on("data", (chunk: Buffer) => (text += chunk.toString()));
        reply.on("end", () =>
          done({ status: reply.statusCode ?? 0, headers: reply.headers, text }),
        );
      });
      sent.on("error", fail);
      sent.end(body);
    },
  );
}

const notes = (root: string) => {
  try {
    return readFileSync(path.join(root, ".blueline", "feedback.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

const post = (url: string, route: string) =>
  fetch(`${url}${route}`, {
    method: "POST",
    body: '{"kind":"note"}',
    headers: { "content-type": "application/json", origin: url },
  });

describe("the Vite plugin", () => {
  it("registers the dev server, and a page's note lands in the root's .blueline", async () => {
    const { root, url } = await vite();
    await registered(url);
    expect((await post(url, ROUTES.feedback)).status).toBe(204);
    expect(notes(root)).toHaveLength(1);
    const apps = await (await fetch(`${serve.url}/blueline/apps`)).json();
    expect(apps).toContainEqual(expect.objectContaining({ root }));
  });

  it("takes the app's own routes", async () => {
    const routes = {
      feedback: "/review/notes",
      status: "/review/status",
      images: "/review/images",
      listening: "/review/listening",
    };
    const { root, url } = await vite({ routes });
    await registered(url, routes);
    expect((await post(url, routes.feedback)).status).toBe(204);
    expect(notes(root)).toHaveLength(1);
    expect((await fetch(`${url}${TAG}`)).status).toBe(200);
    expect(await (await fetch(`${url}${TAG}`)).text()).toContain('"/review/notes"');
  });

  it("logs the page's note as sent, and takes the page's own entries for the log", async () => {
    const { root, url } = await vite();
    await registered(url);
    expect((await post(url, ROUTES.feedback)).status).toBe(204);
    const entry = { event: "shown", note: "n", step: "a", state: "waiting" };
    const page = await fetch(`${url}${ROUTES.log}`, {
      method: "POST",
      body: JSON.stringify(entry),
      headers: { "content-type": "application/json", origin: url },
    });
    expect(page.status).toBe(204);
    const log = readFileSync(path.join(root, ".blueline", "feedback.jsonl.log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l): unknown => JSON.parse(l));
    expect(log).toEqual([
      expect.objectContaining({ event: "sent", kind: "note", at: expect.any(Number) }),
      expect.objectContaining({ ...entry, from: "page", at: expect.any(Number) }),
    ]);
  });

  it("keeps its routes at the root of a dev server with a base", async () => {
    const { root, url } = await vite({}, { base: "/app/" });
    await registered(url);
    expect((await post(url, ROUTES.feedback)).status).toBe(204);
    expect(notes(root)).toHaveLength(1);
  });

  it("refuses another site's page and a host the dev server does not allow, and writes nothing", async () => {
    const { root, url } = await vite();
    await registered(url);
    const port = new URL(url).port;
    const json = { "content-type": "application/json" };
    const site = await raw(
      url,
      ROUTES.feedback,
      { ...json, origin: "https://example.com" },
      "POST",
      "{}",
    );
    expect(site.status).toBe(403);
    const rebound = await raw(
      url,
      ROUTES.feedback,
      { ...json, host: `evil.example:${port}`, origin: `http://evil.example:${port}` },
      "POST",
      "{}",
    );
    expect(rebound.status).toBe(403);
    expect(notes(root)).toHaveLength(0);
  });

  it("puts the overlay on each page, and none with overlay: false", async () => {
    const page = (root: string) =>
      writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
    const on = await vite();
    page(on.root);
    expect(await (await fetch(`${on.url}/`)).text()).toContain(
      `<script type="module" src="${TAG}"></script>`,
    );
    const off = await vite({ overlay: false });
    page(off.root);
    expect(await (await fetch(`${off.url}/`)).text()).not.toContain(TAG);
  });

  it("has the tag import the app's config through Vite, from the dev server's base", async () => {
    const { root, url } = await vite({}, { base: "/app/" });
    expect(await (await fetch(`${url}${TAG}`)).text()).not.toContain("blueline.config");
    writeFileSync(
      path.join(root, "blueline.config.ts"),
      "const journeys: readonly unknown[] = [];\nexport default { journeys };\n",
    );
    const tag = await (await fetch(`${url}${TAG}`)).text();
    expect(tag).toContain('"/app/blueline.config.ts"');
    const config = await fetch(`${url}/app/blueline.config.ts`);
    expect(config.status).toBe(200);
    expect(await config.text()).not.toContain("readonly unknown[]");
  });

  it("serves the overlay from the server, and 304 while it is the same", async () => {
    const { url } = await vite();
    await registered(url);
    const first = await fetch(`${url}${OVERLAY}`);
    expect(first.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const etag = first.headers.get("etag") ?? "";
    expect(await first.text()).toContain("mountPage");
    const again = await raw(url, OVERLAY, { "if-none-match": etag });
    expect(again.status).toBe(304);
  });

  it("registers again after the server restarts", async () => {
    const own = await startServe();
    const root = folder("again");
    const { server, url } = await startVite(root, own);
    servers.push(server);
    await registered(url);
    // Back at once, before the plugin's next try, which would start a server of its own.
    await own.close();
    const back = await startServe({ port: own.port, state: own.state });
    try {
      const apps = (await (await fetch(`${back.url}/blueline/apps`)).json()) as App[];
      const base = apps.find((a) => a.root === server.config.root)?.name ?? "";
      const origin = `http://localhost:${new URL(url).port}`;
      // The new server has the dev server's origin only once the plugin registered again.
      await vi.waitFor(
        async () =>
          expect(
            (await raw(back.url, `/blueline/${base}/feedback`, { origin }, "OPTIONS")).status,
          ).toBe(204),
        { timeout: 8000 },
      );
      expect((await post(url, ROUTES.feedback)).status).toBe(204);
      expect(notes(root)).toHaveLength(1);
    } finally {
      // The dev server goes first, so it does not start a server of its own.
      await server.close();
      servers.splice(servers.indexOf(server), 1);
      await back.close();
    }
  });

  it("ends its registration when the dev server closes", async () => {
    const { server, url } = await vite();
    await registered(url);
    const origin = `http://localhost:${new URL(url).port}`;
    const apps = (await (await fetch(`${serve.url}/blueline/apps`)).json()) as {
      name: string;
      root: string;
    }[];
    const name = apps.find((a) => a.root === server.config.root)?.name ?? "";
    const allowed = () => raw(serve.url, `/blueline/${name}/feedback`, { origin }, "OPTIONS");
    expect((await allowed()).status).toBe(204);
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await vi.waitFor(async () => expect((await allowed()).status).toBe(403));
  });

  it("takes the page's origin in middleware mode, and says when it has none", async () => {
    const middle = async (origin?: string) => {
      const server = await createServer({
        root: folder("middle"),
        configFile: false,
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        plugins: [devtoolsChannel({ serve, ...(origin === undefined ? {} : { origin }) })],
        server: { middlewareMode: true, ws: false },
      });
      servers.push(server);
      return server;
    };
    // The app's own server, which hands requests to Vite.
    const own = async (server: ViteDevServer) => {
      const app = createHttpServer(server.middlewares);
      await new Promise<void>((done) => app.listen(0, "127.0.0.1", done));
      const address = app.address();
      if (typeof address !== "object" || address === null) throw new Error("No port");
      return { url: `http://127.0.0.1:${String(address.port)}`, close: () => app.close() };
    };
    const without = await own(await middle());
    const refused = await post(without.url, ROUTES.feedback);
    expect(refused.status).toBe(503);
    expect(await refused.text()).toContain("origin");
    without.close();
    await middle("http://localhost:3000");
    await vi.waitFor(async () => {
      const apps = (await (await fetch(`${serve.url}/blueline/apps`)).json()) as { root: string }[];
      expect(apps.some((a) => a.root.includes("blueline-middle-"))).toBe(true);
    });
  });

  it("ends the page's answer when the server's answer is cut short", async () => {
    // A server of this Blueline that registers the app, then cuts its answers off after the
    // first bytes.
    const cut = createHttpServer((request, response) => {
      if (request.url === "/blueline/health")
        return void response.end(
          JSON.stringify({ blueline: true, protocol: 2, version: pkg.version, pid: 1 }),
        );
      response.writeHead(200, { "content-length": "1000" });
      if (request.url === "/blueline/register")
        return void response.write(
          `${JSON.stringify({ protocol: 2, name: "cut", base: "/blueline/cut/", files: {} })}\n`,
        );
      response.write("partial");
      setTimeout(() => response.socket?.destroy(), 20);
    });
    await new Promise<void>((done) => cut.listen(0, "127.0.0.1", done));
    const address = cut.address();
    if (typeof address !== "object" || address === null) throw new Error("No port");
    const { server, url } = await startVite(folder("cut"), {
      port: address.port,
      state: serve.state,
    });
    try {
      await registered(url);
      await expect((await fetch(`${url}${OVERLAY}`)).text()).rejects.toThrow();
    } finally {
      await server.close();
      cut.closeAllConnections();
      cut.close();
    }
  });

  it("works on a dev server over HTTPS", async () => {
    const keys = folder("tls");
    const key = path.join(keys, "key.pem");
    const cert = path.join(keys, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        "/CN=localhost",
        "-days",
        "1",
      ],
      { stdio: "ignore" },
    );
    const { root, url } = await vite(
      {},
      { server: { https: { key: readFileSync(key), cert: readFileSync(cert) } } },
    );
    const send = (method: string, body?: string) =>
      new Promise<number>((done, fail) => {
        const sent = httpsRequest(
          `${url}${method === "POST" ? ROUTES.feedback : ROUTES.status}`,
          {
            method,
            rejectUnauthorized: false,
            headers: { "content-type": "application/json", origin: url },
          },
          (reply) => {
            reply.resume();
            done(reply.statusCode ?? 0);
          },
        );
        sent.on("error", fail);
        sent.end(body);
      });
    await vi.waitFor(async () => expect(await send("GET")).toBe(200), { timeout: 5000 });
    expect(await send("POST", "{}")).toBe(204);
    expect(notes(root)).toHaveLength(1);
    rmSync(keys, { recursive: true, force: true });
  });
});
