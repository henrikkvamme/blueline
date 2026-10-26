import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
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
    expect(found).toMatchObject({ kind: "running", health: { blueline: true, protocol: 1 } });
    expect((await fetch(`${url}/blueline/health`)).status).toBe(200);
  });

  it("refuses a Blueline of another protocol", async () => {
    const port = await other((r) => r.end(JSON.stringify({ blueline: true, protocol: 2, pid: 1 })));
    await expect(serve({ port, state })).rejects.toThrow(/protocol 2/);
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
