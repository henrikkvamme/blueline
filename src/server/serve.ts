import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import pkg from "../../package.json" with { type: "json" };
import { filesOf, makeApps, type App, type Apps, type GivenFiles } from "./apps.ts";
import { answer, type ChannelRoute } from "./channel.ts";

/*
 * `blueline serve`: one server on the machine for every app's channel (ADR 0003). A dev
 * server registers its root and its page's origin, and the page reaches its app's channel
 * under `/blueline/<app>/`. The server listens on the loopback address only, and answers
 * only a request that names it as its `Host`, so a site that points a name of its own at
 * the loopback address reads nothing. A request with no `Origin` is a tool's, as the
 * agent's; a page's must come from one of its app's registered origins.
 */

/** Changes only when the routes or the registration change. */
export const PROTOCOL = 1;
export const PORT = 4399;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ROUTES: readonly ChannelRoute[] = ["feedback", "status", "images", "listening"];
const isRoute = (route: string): route is ChannelRoute => ROUTES.some((r) => r === route);
const PROBE_MS = 1000;

export interface Health {
  readonly blueline: true;
  readonly protocol: number;
  readonly version: string;
  readonly pid: number;
}

/** What a registration answers, as its first line. */
export interface Registered {
  readonly protocol: number;
  readonly name: string;
  readonly base: string;
  readonly files: App["files"];
}

export interface ServeOptions {
  readonly port: number;
  /** The folder the server keeps its apps in, across restarts. */
  readonly state: string;
}

export type Served =
  | { readonly kind: "started"; readonly port: number; readonly close: () => Promise<void> }
  /** Another `blueline serve` of the same protocol has the port. */
  | { readonly kind: "running"; readonly health: Health };

const run = promisify(execFile);

/** The repository a root is in: its `git` top level by real path, or the root itself. */
async function repositoryOf(root: string) {
  try {
    const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd: root });
    return await realpath(stdout.trim());
  } catch {
    return root;
  }
}

function end(response: ServerResponse, status: number, body?: unknown) {
  response.statusCode = status;
  if (body === undefined) return void response.end();
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    request.on("error", fail);
  });
}

/** Whether the request names this server: a loopback name and its port. */
function ownHost(host: string | undefined, port: number) {
  if (host === undefined) return false;
  try {
    const url = new URL(`http://${host}`);
    return LOOPBACK.has(url.hostname) && url.port === String(port);
  } catch {
    return false;
  }
}

/** A page's origin as a browser sends it: `http(s)://host[:port]`. */
function isOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

function givenFiles(value: unknown): GivenFiles | undefined {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null) return undefined;
  const files: Record<string, string> = {};
  for (const [key, file] of Object.entries(value)) {
    if (!["feedback", "status", "images", "listening"].includes(key) || !isText(file))
      return undefined;
    files[key] = file;
  }
  return files;
}

async function register(apps: Apps, request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "POST") return end(response, 405);
  // A page cannot register: only a dev server on this machine, which sends no origin.
  if (request.headers.origin !== undefined) return end(response, 403);
  let given: { root?: unknown; origin?: unknown; files?: unknown };
  try {
    given = JSON.parse(await body(request)) as typeof given;
  } catch {
    return end(response, 400, { error: "The registration is not JSON." });
  }
  const files = givenFiles(given.files);
  if (!isText(given.root) || !isOrigin(given.origin) || files === undefined)
    return end(response, 400, { error: "A registration needs a root, an origin and files." });
  const root = await realpath(given.root).catch(() => undefined);
  if (root === undefined || !(await stat(root)).isDirectory())
    return end(response, 400, { error: `No folder at ${given.root}.` });
  const app = apps.app(root, await repositoryOf(root), filesOf(root, files));
  if (app === "conflict")
    return end(response, 409, { error: "A running dev server registered other files." });
  const close = apps.open(app.name, given.origin);
  response.on("close", close);
  const registered: Registered = {
    protocol: PROTOCOL,
    name: app.name,
    base: `/blueline/${app.name}/`,
    files: app.files,
  };
  response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  // The registration lasts while this answer is open.
  response.write(`${JSON.stringify(registered)}\n`);
}

async function listApps(apps: Apps, url: URL, request: IncomingMessage, response: ServerResponse) {
  if (request.headers.origin !== undefined) return end(response, 403);
  const asked = url.searchParams.get("repository");
  if (asked === null) return end(response, 200, apps.all());
  const repository = await realpath(asked).catch(() => path.resolve(asked));
  end(response, 200, apps.inRepository(repository));
}

function channel(apps: Apps, url: URL, request: IncomingMessage, response: ServerResponse) {
  const [name = "", route = "", ...rest] = url.pathname.slice("/blueline/".length).split("/");
  const app = apps.named(name);
  if (app === undefined || !isRoute(route)) return end(response, 404);
  const origin = request.headers.origin;
  if (origin !== undefined) {
    if (!apps.allows(name, origin)) return end(response, 403);
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    response.setHeader("access-control-allow-methods", "GET, POST");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("access-control-max-age", "600");
    if (request.headers["access-control-request-private-network"] === "true")
      response.setHeader("access-control-allow-private-network", "true");
    return end(response, 204);
  }
  answer(
    app.files,
    (r) => r.headers.origin === undefined || apps.allows(name, r.headers.origin),
    route,
    rest.length === 0 ? "" : `/${rest.join("/")}`,
    request,
    response,
  );
}

async function kept(file: string): Promise<readonly App[]> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) return [];
  const value = JSON.parse(text) as { apps?: readonly App[] };
  return value.apps ?? [];
}

/** What answers on `port`: Blueline's health, or a reason it is not. */
async function probe(port: number): Promise<Health | string> {
  try {
    const reply = await fetch(`http://127.0.0.1:${String(port)}/blueline/health`, {
      signal: AbortSignal.timeout(PROBE_MS),
    });
    const health = (await reply.json()) as Partial<Health>;
    if (health.blueline !== true)
      return `Port ${String(port)} is taken by a server that does not answer as Blueline.`;
    return health as Health;
  } catch {
    return `Port ${String(port)} is taken by a server that does not answer as Blueline.`;
  }
}

/** Starts the server, or finds the one that runs. Fails when the port has another server. */
export async function serve(options: ServeOptions): Promise<Served> {
  const file = path.join(options.state, "apps.json");
  let saving = Promise.resolve();
  const save = () => {
    const text = `${JSON.stringify({ protocol: PROTOCOL, apps: apps.all() }, null, 2)}\n`;
    saving = saving
      .then(() => mkdir(options.state, { recursive: true }))
      .then(() => writeFile(`${file}.next`, text))
      .then(() => rename(`${file}.next`, file))
      .catch(() => undefined);
  };
  const apps = makeApps(await kept(file), save);
  const health: Health = {
    blueline: true,
    protocol: PROTOCOL,
    version: pkg.version,
    pid: process.pid,
  };

  // The port it listens on, which a test asks the system for.
  let port = options.port;
  const server = createServer((request, response) => {
    if (!ownHost(request.headers.host, port)) return end(response, 421);
    const url = new URL(request.url ?? "/", "http://blueline");
    const fail = () => end(response, 500);
    if (url.pathname === "/blueline/health") return end(response, 200, health);
    if (url.pathname === "/blueline/register")
      return void register(apps, request, response).catch(fail);
    if (url.pathname === "/blueline/apps")
      return void listApps(apps, url, request, response).catch(fail);
    if (url.pathname.startsWith("/blueline/")) return channel(apps, url, request, response);
    end(response, 404);
  });

  const listened = await new Promise<number | "taken">((done, fail) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      error.code === "EADDRINUSE" ? done("taken") : fail(error),
    );
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) port = address.port;
      done(port);
    });
  });
  if (listened === "taken") {
    const found = await probe(options.port);
    if (typeof found === "string") throw new Error(found);
    if (found.protocol !== PROTOCOL)
      throw new Error(
        `Blueline ${found.version} on port ${String(options.port)} speaks protocol ${String(found.protocol)}; this one speaks ${String(PROTOCOL)}. Stop process ${String(found.pid)} first.`,
      );
    return { kind: "running", health: found };
  }
  return {
    kind: "started",
    port: listened,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await saving;
    },
  };
}
