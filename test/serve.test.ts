import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/server/apps";
import { nameOf } from "../src/server/apps";
import { serve, type Registered, type Served } from "../src/server/serve";

/*
 * `blueline serve` with dev servers that register, pages that post from their origins, and
 * the agent's tools, on a server started in the test on a free port.
 */

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "blueline-serve-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A new repository with the folders in `inside`. */
function repository(name: string, ...inside: string[]) {
  const at = path.join(base, name);
  mkdirSync(at, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: at });
  for (const folder of inside) mkdirSync(path.join(at, folder), { recursive: true });
  return at;
}

let state = "";
let served: Extract<Served, { kind: "started" }> | undefined;
let url = "";
const ended: (() => void)[] = [];

async function start() {
  const result = await serve({ port: 0, state });
  if (result.kind !== "started") throw new Error("Another server answered.");
  served = result;
  url = `http://127.0.0.1:${String(result.port)}`;
}

beforeEach(async () => {
  state = mkdtempSync(path.join(base, "state-"));
  await start();
});
afterEach(async () => {
  for (const end of ended.splice(0)) end();
  await served?.close();
});

/** Registers a dev server; the registration lasts until the test or `end` ends it. */
async function register(root: string, origin: string, files?: Record<string, string>) {
  const stop = new AbortController();
  const reply = await fetch(`${url}/blueline/register`, {
    method: "POST",
    body: JSON.stringify({ root, origin, files }),
    signal: stop.signal,
  });
  const end = () => stop.abort();
  ended.push(end);
  if (reply.status !== 200 || reply.body === null) return { status: reply.status, end };
  const reader = reply.body.getReader();
  const first = await reader.read();
  const app = JSON.parse(new TextDecoder().decode(first.value)) as Registered;
  return { status: 200, app, end };
}

async function registered(root: string, origin: string) {
  const done = await register(root, origin);
  if (done.app === undefined) throw new Error(`Registration failed: ${String(done.status)}`);
  return { ...done.app, end: done.end };
}

/** A request with the headers a fetch cannot set, as `Host`. */
function raw(pathname: string, headers: Record<string, string>, method = "GET") {
  return new Promise<{ status: number; headers: Record<string, unknown> }>((done, fail) => {
    const sent = request(`${url}${pathname}`, { method, headers }, (reply) => {
      reply.resume();
      done({ status: reply.statusCode ?? 0, headers: reply.headers });
    });
    sent.on("error", fail);
    sent.end();
  });
}

const note = (base: string, origin?: string) =>
  fetch(`${url}${base}feedback`, {
    method: "POST",
    body: '{"kind":"note"}',
    headers: { "content-type": "application/json", ...(origin === undefined ? {} : { origin }) },
  });

/** How a page's preflight is answered, which writes nothing. */
const preflight = async (base: string, origin: string) =>
  (await raw(`${base}feedback`, { origin }, "OPTIONS")).status;

const lines = (file: string) => {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

describe("blueline serve", () => {
  it("gives two repositories two apps, each with its own files", async () => {
    const one = repository("one");
    const two = repository("two");
    const a = await registered(one, "http://localhost:5173");
    const b = await registered(two, "http://localhost:5174");
    expect([a.name, b.name]).toEqual(["one", "two"]);
    expect(a.base).toBe("/blueline/one/");
    expect(a.files.feedback).toBe(path.join(one, ".blueline", "feedback.jsonl"));
    expect((await note(a.base, "http://localhost:5173")).status).toBe(204);
    expect(lines(a.files.feedback)).toHaveLength(1);
    expect(lines(b.files.feedback)).toHaveLength(0);
    // Each origin is its own app's only.
    expect((await note(b.base, "http://localhost:5173")).status).toBe(403);
  });

  it("makes one app of two dev servers for one root, and ends only the one that stops", async () => {
    const root = repository("shared");
    const a = await registered(root, "http://localhost:5173");
    const b = await registered(root, "http://localhost:5180");
    expect(b.name).toBe(a.name);
    expect((await note(a.base, "http://localhost:5180")).status).toBe(204);
    expect((await note(a.base, "http://localhost:9999")).status).toBe(403);
    a.end();
    await vi.waitFor(async () =>
      expect(await preflight(a.base, "http://localhost:5173")).toBe(403),
    );
    expect((await note(a.base, "http://localhost:5180")).status).toBe(204);
    expect(lines(a.files.feedback)).toHaveLength(2);
  });

  it("keeps an origin two registrations gave until both end", async () => {
    const root = repository("twice");
    const a = await registered(root, "http://localhost:5173");
    const b = await registered(root, "http://localhost:5173");
    a.end();
    await new Promise((done) => setTimeout(done, 50));
    expect((await note(a.base, "http://localhost:5173")).status).toBe(204);
    b.end();
    await vi.waitFor(async () =>
      expect(await preflight(a.base, "http://localhost:5173")).toBe(403),
    );
  });

  it("names a root in a repository by its path, and two alike paths apart", async () => {
    const repo = repository("mono", "apps/foo-bar", "apps/foo/bar");
    const a = await registered(path.join(repo, "apps/foo-bar"), "http://localhost:1");
    const b = await registered(path.join(repo, "apps/foo/bar"), "http://localhost:2");
    expect([a.name, b.name]).toEqual(["mono-apps-foo-bar", "mono-apps-foo-bar-2"]);
    expect(nameOf("/x/My Repo", "/x/My Repo/web")).toBe("my-repo-web");
  });

  it("takes a link to a root as the root", async () => {
    const root = repository("real");
    const link = path.join(base, "link-to-real");
    symlinkSync(root, link);
    const a = await registered(root, "http://localhost:1");
    const b = await registered(link, "http://localhost:2");
    expect(b.name).toBe(a.name);
    expect(b.files.feedback).toBe(path.join(root, ".blueline", "feedback.jsonl"));
  });

  it("takes files from the root, and refuses other files while a dev server has the app", async () => {
    const root = repository("files");
    const given = { feedback: "notes/review.jsonl", status: "/tmp/status.json" };
    const first = await register(root, "http://localhost:1", given);
    expect(first.app?.files).toEqual({
      feedback: path.join(root, "notes/review.jsonl"),
      status: "/tmp/status.json",
      images: path.join(root, "notes/images"),
      listening: path.join(root, "notes/review.jsonl.listening.json"),
    });
    expect((await register(root, "http://localhost:2")).status).toBe(409);
    expect((await register(root, "http://localhost:2", given)).status).toBe(200);
    // With no dev server left, the next one's files are the app's.
    for (const end of ended.splice(0)) end();
    await vi.waitFor(async () => {
      const again = await register(root, "http://localhost:3");
      expect(again.app?.files.feedback).toBe(path.join(root, ".blueline", "feedback.jsonl"));
    });
  });

  it("refuses a registration from a page, or without a root and an origin", async () => {
    const root = repository("refused");
    const page = await raw("/blueline/register", { origin: "http://localhost:1" }, "POST");
    expect(page.status).toBe(403);
    expect((await register(root, "localhost:1")).status).toBe(400);
    expect((await register(path.join(root, "missing"), "http://localhost:1")).status).toBe(400);
  });

  it("answers only a request that names it as its host", async () => {
    const port = url.split(":").at(-1) ?? "";
    const a = await registered(repository("host"), "http://localhost:5173");
    for (const host of ["evil.example:" + port, "127.0.0.1:1", "localhost"]) {
      expect((await raw("/blueline/health", { host })).status).toBe(421);
      expect((await raw(`${a.base}status`, { host })).status).toBe(421);
    }
    expect((await raw("/blueline/health", { host: `localhost:${port}` })).status).toBe(200);
  });

  it("answers a page's preflight and its post with its own origin", async () => {
    const a = await registered(repository("cors"), "http://localhost:5173");
    const preflight = await raw(
      `${a.base}feedback`,
      {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
      "OPTIONS",
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers).toMatchObject({
      "access-control-allow-origin": "http://localhost:5173",
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers": "content-type",
      vary: "Origin",
    });
    const posted = await note(a.base, "http://localhost:5173");
    expect(posted.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const other = await raw(`${a.base}feedback`, { origin: "http://localhost:1" }, "OPTIONS");
    expect(other.status).toBe(403);
    expect((await fetch(`${url}/blueline/nobody/feedback`)).status).toBe(404);
  });

  it("keeps the apps and their names after a restart, and lists a repository's", async () => {
    const repo = repository("kept", "web", "admin");
    const web = await registered(path.join(repo, "web"), "http://localhost:1");
    await registered(path.join(repo, "admin"), "http://localhost:2");
    await registered(repository("elsewhere"), "http://localhost:3");
    for (const end of ended.splice(0)) end();
    await served?.close();
    await start();
    const listed = await fetch(`${url}/blueline/apps?repository=${encodeURIComponent(repo)}`);
    const apps = (await listed.json()) as App[];
    expect(apps.map((a) => a.name).sort()).toEqual(["kept-admin", "kept-web"]);
    expect(apps.find((a) => a.name === "kept-web")?.files).toEqual(web.files);
    // A tool still reads the app's answers with no dev server running.
    expect((await fetch(`${url}${web.base}status`)).status).toBe(200);
    // A page cannot list them.
    expect((await raw("/blueline/apps", { origin: "http://localhost:1" })).status).toBe(403);
  });
});

describe("blueline serve on bad input", () => {
  const port = () => Number(url.split(":").at(-1));

  it("leaves no registration open for a dev server that went before it opened", async () => {
    const root = repository("went");
    await new Promise<void>((done) => {
      const sent = request(`${url}/blueline/register`, { method: "POST" });
      sent.on("error", () => done());
      sent.end(JSON.stringify({ root, origin: "http://localhost:7000" }), () => {
        sent.destroy();
        done();
      });
    });
    await new Promise((done) => setTimeout(done, 200));
    const other = await register(root, "http://localhost:7001", { feedback: "other.jsonl" });
    expect(other.status).toBe(200);
    expect(await preflight("/blueline/went/", "http://localhost:7000")).toBe(403);
  });

  it("answers a request target it cannot read, and keeps serving", async () => {
    const reply = await new Promise<string>((done) => {
      const socket = connect(port(), "127.0.0.1", () =>
        socket.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${String(port())}\r\n\r\n`),
      );
      socket.once("data", (data) => {
        done(data.toString());
        socket.destroy();
      });
    });
    expect(reply).toMatch(/^HTTP\/1.1 400/);
    expect((await fetch(`${url}/blueline/health`)).status).toBe(200);
  });

  it("does not start on a state file it cannot read, and leaves the file", async () => {
    const folder = mkdtempSync(path.join(base, "bad-"));
    const file = path.join(folder, "apps.json");
    const app = { name: "a", root: "/a", repository: "/a", files: null };
    for (const text of ["{nope", "{}", JSON.stringify({ apps: [app] }), '{"apps":{}}']) {
      writeFileSync(file, text);
      await expect(serve({ port: 0, state: folder })).rejects.toThrow(/does not hold Blueline/);
      expect(readFileSync(file, "utf8")).toBe(text);
    }
  });

  it("forgets at the start an app whose folder is gone", async () => {
    await register(repository("stays"), "http://localhost:1");
    const gone = repository("gone");
    await register(gone, "http://localhost:2");
    await served?.close();
    rmSync(gone, { recursive: true, force: true });
    await start();
    const listed = (await (await fetch(`${url}/blueline/apps`)).json()) as { root: string }[];
    expect(listed.map((a) => path.basename(a.root))).toEqual(["stays"]);
    await vi.waitFor(() =>
      expect(readFileSync(path.join(state, "apps.json"), "utf8")).not.toContain(gone),
    );
  });

  it("does not start where it cannot keep its apps", async () => {
    const taken = path.join(base, "a-file");
    writeFileSync(taken, "");
    await expect(serve({ port: 0, state: taken })).rejects.toThrow(/cannot (read|keep) its apps/);
  });

  it("refuses a registration it cannot keep", async () => {
    const root = repository("unkept");
    rmSync(state, { recursive: true, force: true });
    writeFileSync(state, "");
    const refused = await register(root, "http://localhost:1");
    expect(refused.status).toBe(500);
    expect(await preflight("/blueline/unkept/", "http://localhost:1")).toBe(403);
    // Once the folder is there again, the same registration is kept.
    rmSync(state);
    mkdirSync(state);
    expect((await register(root, "http://localhost:1")).status).toBe(200);
    expect(readFileSync(path.join(state, "apps.json"), "utf8")).toContain("unkept");
  });

  it("lets one of several registrations at once set the app's files", async () => {
    const root = repository("race");
    const tried = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        register(root, `http://localhost:${String(n)}`, { feedback: `${String(n)}.jsonl` }),
      ),
    );
    const kept = tried.filter((t) => t.status === 200);
    expect(kept).toHaveLength(1);
    expect(tried.filter((t) => t.status === 409)).toHaveLength(3);
    const status = await fetch(`${url}${kept[0]?.app?.base ?? ""}status`);
    expect(status.status).toBe(200);
  });
});

describe("a second blueline serve", () => {
  const others: Server[] = [];
  afterAll(() => others.forEach((s) => s.close()));

  /** A server on a free port that answers with `reply`, or not at all. */
  async function other(reply?: (response: import("node:http").ServerResponse) => void) {
    const server = createServer((_request, response) => reply?.(response));
    others.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("No port");
    return address.port;
  }

  it("finds the first and leaves it", async () => {
    const port = Number(url.split(":").at(-1));
    const found = await serve({ port, state });
    expect(found).toMatchObject({ kind: "running", health: { blueline: true, protocol: 2 } });
    expect((await fetch(`${url}/blueline/health`)).status).toBe(200);
  });

  it("refuses a Blueline of another protocol, as B1's, by its process", async () => {
    const port = await other((r) =>
      r.end(JSON.stringify({ blueline: true, protocol: 1, version: "0.0.0", pid: 41 })),
    );
    await expect(serve({ port, state })).rejects.toThrow(/protocol 1.*Stop process 41/);
  });

  it("fails in time on a server that is not Blueline, or does not answer", async () => {
    const plain = await other((r) => r.end("<html></html>"));
    await expect(serve({ port: plain, state })).rejects.toThrow(/does not answer as Blueline/);
    const silent = await other();
    const started = Date.now();
    await expect(serve({ port: silent, state })).rejects.toThrow(/does not answer as Blueline/);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("blueline serve for pages", () => {
  const page = "http://localhost:6100";

  it("serves the overlay with its ETag, 304 while it is the same, and a new ETag for a new build", async () => {
    await served?.close();
    const overlay = path.join(mkdtempSync(path.join(base, "dist-")), "index.js");
    writeFileSync(overlay, "export const one = 1;\n");
    const result = await serve({ port: 0, state, overlay });
    if (result.kind !== "started") throw new Error("Another server answered.");
    served = result;
    url = `http://127.0.0.1:${String(result.port)}`;
    const first = await fetch(`${url}/blueline/overlay.js`, { headers: { origin: page } });
    expect(first.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(first.headers.get("access-control-allow-origin")).toBe("*");
    const etag = first.headers.get("etag") ?? "";
    expect((await raw("/blueline/overlay.js", { "if-none-match": etag })).status).toBe(304);
    writeFileSync(overlay, "export const two = 2;\n");
    const second = await fetch(`${url}/blueline/overlay.js`, {
      headers: { "if-none-match": etag },
    });
    expect(second.status).toBe(200);
    expect(second.headers.get("etag")).not.toBe(etag);
    rmSync(overlay);
    const none = await fetch(`${url}/blueline/overlay.js`);
    expect(none.status).toBe(503);
    expect(await none.text()).toContain("pnpm run pack");
  });

  it("gives a page of the app's origins its tag, on the app's channel at this server", async () => {
    const a = await registered(repository("tagged"), page);
    const tag = await fetch(`${url}${a.base}tag.js`, { headers: { origin: page } });
    expect(tag.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(tag.headers.get("access-control-allow-origin")).toBe(page);
    expect(tag.headers.get("vary")).toBe("Origin");
    const text = await tag.text();
    expect(text).toContain(`await import("${url}/blueline/overlay.js")`);
    expect(text).toContain(`"feedback":"${url}${a.base}feedback"`);
    expect(text).toContain(`"storageKey":"blueline.${a.name}"`);
    expect((await raw(`${a.base}tag.js`, { origin: "http://localhost:1" })).status).toBe(403);
    expect((await fetch(`${url}/blueline/nobody/tag.js`)).status).toBe(404);
  });

  it("serves an app's config without its types, its import named at this server", async () => {
    const root = repository("configured");
    writeFileSync(
      path.join(root, "blueline.config.ts"),
      [
        'import { defineConfig, type BluelineConfig } from "@henrikkvamme/blueline/config";',
        "const steps: BluelineConfig['journeys'][number]['steps'] = [];",
        'export default defineConfig({ journeys: [{ id: "j", title: "J", steps }] });',
        "",
      ].join("\n"),
    );
    const a = await registered(root, page);
    const config = await fetch(`${url}${a.base}config.js`, { headers: { origin: page } });
    expect(config.status).toBe(200);
    expect(config.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(config.headers.get("access-control-allow-origin")).toBe(page);
    const text = await config.text();
    expect(text).toContain(`import { defineConfig } from "${url}/blueline/config.js"`);
    expect(text).not.toContain("BluelineConfig");
    expect(text).toContain("const steps = [];");
    const tag = await (await fetch(`${url}${a.base}tag.js`, { headers: { origin: page } })).text();
    expect(tag).toContain(`"${url}${a.base}config.js"`);
    expect(tag).toContain(`new EventSource("${url}${a.base}events")`);
    expect((await raw(`${a.base}config.js`, { origin: "http://localhost:1" })).status).toBe(403);
    expect((await fetch(`${url}/blueline/nobody/config.js`)).status).toBe(404);
  });

  it("gives a tag no config, and 404 for it, when the root has none", async () => {
    const a = await registered(repository("plain"), page);
    const tag = await (await fetch(`${url}${a.base}tag.js`, { headers: { origin: page } })).text();
    expect(tag).not.toContain("config.js");
    expect((await fetch(`${url}${a.base}config.js`, { headers: { origin: page } })).status).toBe(
      404,
    );
  });

  it("refuses a config that imports other code, and names the Vite plugin", async () => {
    const root = repository("importing");
    writeFileSync(
      path.join(root, "blueline.config.js"),
      'import { steps } from "./steps.js";\nexport default { journeys: [{ id: "j", title: "J", steps }] };\n',
    );
    const a = await registered(root, page);
    const refused = await fetch(`${url}${a.base}config.js`, { headers: { origin: page } });
    expect(refused.status).toBe(500);
    const why = await refused.text();
    expect(why).toContain("./steps.js");
    expect(why).toContain("devtoolsChannel()");
    writeFileSync(
      path.join(root, "blueline.config.js"),
      'export default await import("./steps.js");\n',
    );
    expect((await fetch(`${url}${a.base}config.js`, { headers: { origin: page } })).status).toBe(
      500,
    );
  });

  it("answers 404 for the events of a root that is gone, and keeps serving", async () => {
    const root = repository("gone");
    const a = await registered(root, page);
    rmSync(root, { recursive: true, force: true });
    const events = await fetch(`${url}${a.base}events`, { headers: { origin: page } });
    expect(events.status).toBe(404);
    expect((await fetch(`${url}/blueline/health`)).status).toBe(200);
  });

  it("serves the built config module to any page", async () => {
    await served?.close();
    const config = path.join(mkdtempSync(path.join(base, "dist-")), "config.js");
    writeFileSync(config, "export const defineConfig = (config) => config;\n");
    const result = await serve({ port: 0, state, config });
    if (result.kind !== "started") throw new Error("Another server answered.");
    served = result;
    url = `http://127.0.0.1:${String(result.port)}`;
    const module = await fetch(`${url}/blueline/config.js`, { headers: { origin: page } });
    expect(module.headers.get("access-control-allow-origin")).toBe("*");
    expect(await module.text()).toContain("defineConfig");
  });

  it("tells a page of the app's origins when the config changes, and no other page", async () => {
    const root = repository("watched");
    const file = path.join(root, "blueline.config.ts");
    writeFileSync(file, "export default { journeys: [] };\n");
    const a = await registered(root, page);
    expect((await raw(`${a.base}events`, { origin: "http://localhost:1" })).status).toBe(403);
    const stop = new AbortController();
    ended.push(() => stop.abort());
    const events = await fetch(`${url}${a.base}events`, {
      headers: { origin: page },
      signal: stop.signal,
    });
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    expect(events.headers.get("access-control-allow-origin")).toBe(page);
    const reader = events.body?.getReader();
    if (reader === undefined) throw new Error("No events");
    let text = "";
    const heard = (async () => {
      while (!text.includes("event: change")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += new TextDecoder().decode(chunk.value);
      }
    })();
    // The server watches once the page listens.
    await vi.waitFor(() => expect(text).toContain(": listening"));
    writeFileSync(file, 'export default { journeys: [{ id: "j", title: "J", steps: [] }] };\n');
    await heard;
    expect(text).toContain("event: change");
  });

  it("keeps an origin for a tag by hand across restarts, until it is removed", async () => {
    const root = repository("by-hand");
    const keep = (origin: string, headers: Record<string, string> = {}) =>
      fetch(`${url}/blueline/register`, {
        method: "POST",
        body: JSON.stringify({ root, origin, keep: true }),
        headers,
      });
    const kept = await keep(page);
    expect(kept.status).toBe(200);
    const app = (await kept.json()) as Registered;
    // A page cannot keep its own origin.
    expect((await keep("http://localhost:1", { origin: "http://localhost:1" })).status).toBe(403);
    await served?.close();
    await start();
    expect(await preflight(app.base, page)).toBe(204);
    expect((await note(app.base, page)).status).toBe(204);
    const removed = await fetch(`${url}/blueline/remove`, {
      method: "POST",
      body: JSON.stringify({ root, origin: page }),
    });
    expect(removed.status).toBe(200);
    expect(await preflight(app.base, page)).toBe(403);
    const again = await fetch(`${url}/blueline/remove`, {
      method: "POST",
      body: JSON.stringify({ root, origin: page }),
    });
    expect(again.status).toBe(404);
  });

  it("keeps an origin whose removal it could not save", async () => {
    const root = repository("unremoved");
    const kept = await fetch(`${url}/blueline/register`, {
      method: "POST",
      body: JSON.stringify({ root, origin: page, keep: true }),
    });
    const app = (await kept.json()) as Registered;
    const remove = () =>
      fetch(`${url}/blueline/remove`, {
        method: "POST",
        body: JSON.stringify({ root, origin: page }),
      });
    rmSync(state, { recursive: true, force: true });
    writeFileSync(state, "");
    expect((await remove()).status).toBe(500);
    expect(await preflight(app.base, page)).toBe(204);
    rmSync(state);
    mkdirSync(state);
    expect((await remove()).status).toBe(200);
    expect(await preflight(app.base, page)).toBe(403);
  });

  it("stops when a tool asks, and not when a page does", async () => {
    const stopped = vi.fn();
    await served?.close();
    const result = await serve({ port: 0, state, stopped });
    if (result.kind !== "started") throw new Error("Another server answered.");
    served = result;
    url = `http://127.0.0.1:${String(result.port)}`;
    expect((await raw("/blueline/stop", { origin: page }, "POST")).status).toBe(403);
    expect((await fetch(`${url}/blueline/stop`, { method: "POST" })).status).toBe(204);
    await vi.waitFor(() => expect(stopped).toHaveBeenCalled());
    await expect(fetch(`${url}/blueline/health`)).rejects.toThrow();
  });
});
