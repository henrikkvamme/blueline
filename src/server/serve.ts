import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import pkg from "../../package.json" with { type: "json" };
import { filesOf, makeApps, type App, type Apps, type GivenFiles } from "./apps.ts";
import { answer, type ChannelRoute } from "./channel.ts";
import { packageRoot } from "./package.ts";

/*
 * `blueline serve`: one server on the machine for every app's channel (ADR 0003). A dev
 * server registers its root and its page's origin, and the page reaches its app's channel
 * under `/blueline/<app>/`. The server listens on the loopback address only, and answers
 * only a request that names it as its `Host`, so a site that points a name of its own at
 * the loopback address reads nothing. A request with no `Origin` is a tool's, as the
 * agent's; a page's must come from one of its app's registered origins. The server also
 * serves the overlay, and a tag for a page that loads it by hand.
 */

/** Changes only when the routes or the registration change. */
export const PROTOCOL = 2;
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
  /** The built overlay it serves: by default this package's `dist/index.js`. */
  readonly overlay?: string;
  /** Runs when a tool asks the server to stop (`blueline serve stop`), once it closed. */
  readonly stopped?: () => void;
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

async function register(
  apps: Apps,
  saved: () => Promise<void>,
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") return end(response, 405);
  // A dev server that goes before its registration opens leaves none open.
  let gone = false;
  response.on("close", () => (gone = true));
  // A page cannot register: only a dev server on this machine, which sends no origin.
  if (request.headers.origin !== undefined) return end(response, 403);
  let given: { root?: unknown; origin?: unknown; files?: unknown; keep?: unknown };
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
  // A kept origin is for the app as it is: its files stay.
  const keep = given.keep === true;
  const known = keep ? apps.rooted(root) : undefined;
  const app = known ?? apps.app(root, await repositoryOf(root), filesOf(root, files));
  if (app === "conflict")
    return end(response, 409, { error: "A running dev server registered other files." });
  if (keep) {
    apps.keep(app.name, given.origin, true);
    try {
      await saved();
    } catch (error) {
      apps.keep(app.name, given.origin, false);
      return end(response, 500, { error: String(error) });
    }
    return end(response, 200, registeredOf(app));
  }
  // Open at once, so no other registration changes the app's files while this one waits.
  const close = apps.open(app.name, given.origin);
  if (gone) return close();
  response.on("close", close);
  try {
    await saved();
  } catch (error) {
    close();
    return end(response, 500, { error: String(error) });
  }
  response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  // The registration lasts while this answer is open.
  response.write(`${JSON.stringify(registeredOf(app))}\n`);
}

const registeredOf = (app: App): Registered => ({
  protocol: PROTOCOL,
  name: app.name,
  base: `/blueline/${app.name}/`,
  files: app.files,
});

/** Removes a kept origin (`blueline remove`). */
async function remove(
  apps: Apps,
  saved: () => Promise<void>,
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") return end(response, 405);
  if (request.headers.origin !== undefined) return end(response, 403);
  let given: { root?: unknown; origin?: unknown };
  try {
    given = JSON.parse(await body(request)) as typeof given;
  } catch {
    return end(response, 400, { error: "The request is not JSON." });
  }
  if (!isText(given.root) || !isOrigin(given.origin))
    return end(response, 400, { error: "A removal needs a root and an origin." });
  const root = await realpath(given.root).catch(() => given.root);
  const app = typeof root === "string" ? apps.rooted(root) : undefined;
  if (app === undefined || !apps.keep(app.name, given.origin, false))
    return end(response, 404, { error: `${given.origin} is not kept for ${given.root}.` });
  await saved();
  end(response, 200, registeredOf(app));
}

/** The built overlay, read again only when its file changes. */
function overlayFile(file: string) {
  let read: { mtime: number; size: number; body: Buffer; etag: string } | undefined;
  return async () => {
    const found = await stat(file);
    if (read?.mtime === found.mtimeMs && read.size === found.size) return read;
    const body = await readFile(file);
    const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
    read = { mtime: found.mtimeMs, size: found.size, body, etag };
    return read;
  };
}

async function serveOverlay(
  overlay: ReturnType<typeof overlayFile>,
  request: IncomingMessage,
  response: ServerResponse,
) {
  // Code with no data: any page may load it, and a module script loads in CORS mode.
  response.setHeader("access-control-allow-origin", "*");
  const found = await overlay().catch(() => undefined);
  if (found === undefined) {
    response.statusCode = 503;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    return void response.end(
      "Blueline has no build of its overlay. Run `pnpm run pack` in Blueline.",
    );
  }
  response.setHeader("etag", found.etag);
  // Asked again each time, and answered 304 while the build is the same.
  response.setHeader("cache-control", "no-cache");
  response.setHeader("content-type", "text/javascript; charset=utf-8");
  if (request.headers["if-none-match"] === found.etag) return end(response, 304);
  response.end(found.body);
}

/** The module a page loads by hand: the overlay on the app's channel, at this server. */
function tag(app: App, host: string, response: ServerResponse) {
  const at = `http://${host}`;
  const base = `${at}/blueline/${app.name}/`;
  const options = {
    storageKey: `blueline.${app.name}`,
    routes: {
      feedback: `${base}feedback`,
      status: `${base}status`,
      images: `${base}images`,
      listening: `${base}listening`,
    },
  };
  response.setHeader("content-type", "text/javascript; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(
    `import { mountPage } from "${at}/blueline/overlay.js";\nmountPage(${JSON.stringify(options)});\n`,
  );
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
  if (app === undefined || (!isRoute(route) && route !== "tag.js")) return end(response, 404);
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
  if (route === "tag.js") return tag(app, request.headers.host ?? "", response);
  if (!isRoute(route)) return end(response, 404);
  answer(
    app.files,
    (r) => r.headers.origin === undefined || apps.allows(name, r.headers.origin),
    route,
    rest.length === 0 ? "" : `/${rest.join("/")}`,
    request,
    response,
  );
}

const isFiles = (value: unknown): value is App["files"] =>
  typeof value === "object" &&
  value !== null &&
  ["feedback", "status", "images", "listening"].every((key) => isText(Reflect.get(value, key)));

/** A kept app, or undefined when it is not one; an app from before B2 keeps no origins. */
function appOf(value: unknown): App | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { name, root, repository, files } = value as Partial<Record<keyof App, unknown>>;
  const kept: unknown = Reflect.get(value, "kept") ?? [];
  if (!isText(name) || !isText(root) || !isText(repository) || !isFiles(files)) return undefined;
  if (!Array.isArray(kept) || !kept.every(isOrigin)) return undefined;
  return { name, root, repository, files, kept };
}

/** The apps kept before; a file Blueline cannot read stops it, so it overwrites nothing. */
async function kept(file: string): Promise<readonly App[]> {
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`Blueline cannot read its apps in ${file}: ${error.message}`);
  });
  if (text === undefined) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  const apps = typeof value === "object" && value !== null && "apps" in value ? value.apps : null;
  const read = Array.isArray(apps) ? apps.map(appOf) : [undefined];
  if (read.some((app) => app === undefined))
    throw new Error(`${file} does not hold Blueline's apps. Move it away to start afresh.`);
  return read.filter((app) => app !== undefined);
}

/** What answers on a port: Blueline of this protocol, nothing, or why the server there is
 * not one to use. */
export type Found =
  | { readonly kind: "blueline"; readonly health: Health }
  | { readonly kind: "none" }
  | { readonly kind: "other"; readonly reason: string };

export async function probe(port: number): Promise<Found> {
  const taken = `Port ${String(port)} is taken by a server that does not answer as Blueline.`;
  let health: Partial<Health>;
  try {
    const reply = await fetch(`http://127.0.0.1:${String(port)}/blueline/health`, {
      signal: AbortSignal.timeout(PROBE_MS),
    });
    health = (await reply.json()) as Partial<Health>;
  } catch (error) {
    const code: unknown = error instanceof Error ? Reflect.get(Object(error.cause), "code") : "";
    return code === "ECONNREFUSED" ? { kind: "none" } : { kind: "other", reason: taken };
  }
  if (health.blueline !== true) return { kind: "other", reason: taken };
  if (health.protocol !== PROTOCOL)
    return {
      kind: "other",
      reason: `Blueline ${String(health.version)} on port ${String(port)} speaks protocol ${String(health.protocol)}; this one speaks ${String(PROTOCOL)}. Stop process ${String(health.pid)}, then start again.`,
    };
  return { kind: "blueline", health: health as Health };
}

/** Starts the server, or finds the one that runs. Fails when the port has another server. */
export async function serve(options: ServeOptions): Promise<Served> {
  const file = path.join(options.state, "apps.json");
  // One save at a time, each with the apps as they are when it starts; the last says
  // whether the apps are kept.
  let saving = Promise.resolve();
  let failed = false;
  const save = () => {
    saving = saving
      .catch(() => undefined)
      .then(async () => {
        const text = `${JSON.stringify({ protocol: PROTOCOL, apps: apps.all() }, null, 2)}\n`;
        await mkdir(options.state, { recursive: true });
        await writeFile(`${file}.next`, text);
        await rename(`${file}.next`, file);
        failed = false;
      })
      .catch((error: unknown) => {
        failed = true;
        throw new Error(
          `Blueline cannot keep its apps in ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    // A failed save is answered where a registration waits for it, and does not stop the server.
    saving.catch(() => undefined);
  };
  /** The apps' last save, made again when it failed, so a repaired folder keeps them. */
  const saved = () => {
    if (failed) save();
    return saving;
  };
  const apps = makeApps(await kept(file), save);
  const overlay = overlayFile(options.overlay ?? path.join(packageRoot(), "dist", "index.js"));
  const health: Health = {
    blueline: true,
    protocol: PROTOCOL,
    version: pkg.version,
    pid: process.pid,
  };

  // The port it listens on, which a test asks the system for.
  let port = options.port;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await saving.catch(() => undefined);
    })();
    return closing;
  };
  const server = createServer((request, response) => {
    if (!ownHost(request.headers.host, port)) return end(response, 421);
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://blueline");
    } catch {
      return end(response, 400);
    }
    const fail = () => end(response, 500);
    if (url.pathname === "/blueline/health") return end(response, 200, health);
    if (url.pathname === "/blueline/register")
      return void register(apps, saved, request, response).catch(fail);
    if (url.pathname === "/blueline/apps")
      return void listApps(apps, url, request, response).catch(fail);
    if (url.pathname === "/blueline/remove")
      return void remove(apps, saved, request, response).catch(fail);
    if (url.pathname === "/blueline/overlay.js")
      return void serveOverlay(overlay, request, response).catch(fail);
    if (url.pathname === "/blueline/stop") {
      if (request.method !== "POST") return end(response, 405);
      if (request.headers.origin !== undefined) return end(response, 403);
      end(response, 204);
      return void close().then(() => options.stopped?.());
    }
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
    if (found.kind === "none")
      throw new Error(`Port ${String(options.port)} was taken, and is free again. Start again.`);
    if (found.kind === "other") throw new Error(found.reason);
    return { kind: "running", health: found.health };
  }
  // The server keeps its apps from the start, or does not start.
  save();
  try {
    await saved();
  } catch (error) {
    await new Promise<void>((done) => server.close(() => done()));
    throw error;
  }
  return { kind: "started", port: listened, close };
}
