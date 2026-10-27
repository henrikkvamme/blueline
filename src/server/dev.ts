import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  createServer,
  request as send,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createListener, isIP, type Server, type Socket } from "node:net";
import { constants as os, tmpdir } from "node:os";
import path from "node:path";
import { pipeline, Transform, type Duplex } from "node:stream";
import zlib from "node:zlib";
import {
  devCommandOf,
  listenOf,
  viteInputsOf,
  type DevServer,
  type Listen,
  type ViteServer,
} from "./command.ts";
import { configFile, configModule } from "./config.ts";
import { tagInHtml } from "./html.ts";
import { guardFile, hookFile } from "./package.ts";
import { CHANNEL_ROUTES, forward, fromPage, OVERLAY, refuse, ROUTES, TAG } from "./page.ts";
import { holdRegistration, type Holding, type Place } from "./start.ts";
import { tagModule } from "./tag.ts";

/*
 * `blueline dev -- <cmd>` (ADR 0004): runs the app's dev command behind a proxy on the port
 * the page would use, so an app with no plugin gets the overlay with no change to its code.
 * The proxy holds the page's port before the command starts. A preload in each Node process
 * of the command (src/server/hook.ts) moves the dev server's listen to a port the system
 * gives, and reports it; the proxy sends each request and websocket there, with its `Host`.
 * It answers Blueline's own routes as the Vite plugin does, and puts the overlay's tag in
 * each HTML page as it streams. A guard (src/server/guard.ts) starts the command in a
 * process group of its own, and stops the whole group when `blueline dev` stops or dies.
 */

const REPORT_WAIT_MS = 20_000;
const POLL_MS = 100;
const VITE_CONFIG_MS = 30_000;
const CONFIG_JS = "/__devtools/config.js";
const CONFIG_MODULE = "/__devtools/config-module.js";
const EVENTS = "/__devtools/events";
const PREFIX = "/__devtools/";
const TAG_HTML = `<script type="module" src="${TAG}"></script>`;

export interface DevOptions {
  /** The app's root, where the command runs. */
  readonly root: string;
  readonly command: readonly string[];
  /** The page's port, for a dev server that `blueline dev` does not know. */
  readonly port?: number | undefined;
  /** Where the proxy listens, in place of the dev server's host. */
  readonly host?: string | undefined;
  /** Where `blueline serve` runs. */
  readonly place: Place;
  /** Says a line to the person who runs `blueline dev`. */
  readonly say: (line: string) => void;
  /** The environment the command gets: by default this process's. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface Dev {
  /** The page's port. */
  readonly port: number;
  /** The page's address. */
  readonly url: string;
  /** The command's exit code once it ended and every part stopped: its own code, or 128
   * plus its signal's number. */
  readonly ended: Promise<number>;
  /** Stops the proxy, the registration and the command's whole group. */
  readonly stop: () => Promise<number>;
}

/** The dev server's real address, as the preload reports it. */
interface Upstream {
  readonly host: string;
  readonly port: number;
}

/** What the guard says, one JSON line each. */
interface GuardEvent {
  readonly started?: number;
  readonly failed?: string;
  readonly exit?: boolean;
  readonly code?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stopped?: boolean;
}

/** The headers of one hop, which no proxy sends on (RFC 9110, 7.6.1). */
const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** The headers without those of one hop, and those that its `connection` names. */
export function hopless(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const named = new Set(
    String(headers.connection ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !HOP.has(name) && !named.has(name)),
  );
}

/** The codings the proxy can take off, to read an HTML answer. */
const DECODERS: Readonly<Record<string, (() => Transform) | undefined>> = {
  gzip: () => zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH }),
  "x-gzip": () => zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH }),
  deflate: () => zlib.createInflate({ flush: zlib.constants.Z_SYNC_FLUSH }),
  br: () => zlib.createBrotliDecompress({ flush: zlib.constants.BROTLI_OPERATION_FLUSH }),
  ...("createZstdDecompress" in zlib && typeof zlib.createZstdDecompress === "function"
    ? { zstd: () => zlib.createZstdDecompress() }
    : {}),
};

/** `accept-encoding` with only the codings the proxy can take off. */
function decodable(accept: string | undefined): string | undefined {
  if (accept === undefined) return undefined;
  const kept = accept
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      const coding = (part.split(";")[0] ?? "").trim().toLowerCase();
      return coding === "identity" || coding === "*" ? coding === "identity" : coding in DECODERS;
    });
  return kept.length === 0 ? "identity" : kept.join(", ");
}

/** The headers that name the dev server's bytes, which an answer with the tag loses. */
const OF_THE_BYTES = ["content-length", "content-encoding", "content-md5", "etag", "last-modified"];

const hasBody = (method: string | undefined, status: number) =>
  method !== "HEAD" && status >= 200 && status !== 204 && status !== 304;

/** Whether a page's `Host` is one the dev server takes: a loopback name or an IP address, its
 * own host, or a name in its allowed hosts, as Vite checks. */
export function hostAllowed(host: string | undefined, listen: Listen): boolean {
  if (host === undefined) return false;
  let name: string;
  try {
    name = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = name.startsWith("[") ? name.slice(1, -1) : name;
  if (bare === "localhost" || bare.endsWith(".localhost") || isIP(bare) !== 0) return true;
  if (typeof listen.host === "string" && listen.host.toLowerCase() === bare) return true;
  if (listen.allowedHosts === true) return true;
  return listen.allowedHosts.some((allowed) =>
    allowed.startsWith(".")
      ? bare === allowed.slice(1) || bare.endsWith(allowed)
      : bare === allowed,
  );
}

/** Vite's resolved config in the app, from the app's own Vite, in a process of its own with
 * the dev server's environment. */
async function viteConfigOf(
  root: string,
  server: DevServer,
  env: Readonly<Record<string, string | undefined>>,
): Promise<ViteServer> {
  const inputs = viteInputsOf(server.args);
  const module = server.program === "vp" ? "vite-plus" : "vite";
  const code = `
const [module, inputs] = JSON.parse(process.argv[1]);
const vite = await import(module);
const config = await vite.resolveConfig(
  { root: inputs.root, configFile: inputs.file, mode: inputs.mode, configLoader: inputs.loader, logLevel: "silent" },
  "serve",
  inputs.mode ?? "development",
);
const { port, host, https, allowedHosts } = config.server;
process.stdout.write("\\n@blueline " + JSON.stringify({ port, host, https: Boolean(https), allowedHosts }) + "\\n");
process.exit(0);
`;
  const out = await new Promise<string>((done, fail) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", code, JSON.stringify([module, inputs])],
      { cwd: root, env: { ...env, ...server.env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let text = "";
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGKILL"), VITE_CONFIG_MS);
    child.once("error", fail);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) done(text);
      else fail(new Error(`Vite's config in ${root} did not load:\n${errors.trim()}`));
    });
  });
  const line = out
    .split("\n")
    .filter((each) => each.startsWith("@blueline "))
    .at(-1);
  if (line === undefined) throw new Error(`Vite's config in ${root} gave nothing.`);
  return JSON.parse(line.slice("@blueline ".length)) as ViteServer;
}

/** Listens on `port` at `host`, or says that the port is taken. */
function listenOn(server: Server, port: number, host: string, ipv6Only = false) {
  return new Promise<"listening" | "taken" | "absent">((done, fail) => {
    const failed = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") done("taken");
      else if (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT") done("absent");
      else fail(error);
    };
    server.once("error", failed);
    server.listen({ port, host, ipv6Only }, () => {
      server.off("error", failed);
      done("listening");
    });
  });
}

/** The hosts the proxy holds the page's port on: each loopback address for `localhost`,
 * every address for `true`, or the host itself. */
const hostsOf = (host: string | true) =>
  host === true ? ["::", "0.0.0.0"] : host === "localhost" ? ["127.0.0.1", "::1"] : [host];

const decodeList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding !== "" && coding !== "identity");

/** The command's exit code from its end. */
const codeOf = (code: number | null | undefined, signal: NodeJS.Signals | null | undefined) =>
  typeof code === "number" ? code : signal ? 128 + (os.signals[signal] ?? 0) : 1;

/** The `node_modules/.bin` folders from the root up, as a package manager puts on `PATH`. */
function binsOf(root: string) {
  const bins: string[] = [];
  for (let at = root; ; at = path.dirname(at)) {
    bins.push(path.join(at, "node_modules", ".bin"));
    if (path.dirname(at) === at) return bins;
  }
}

export async function startDev(options: DevOptions): Promise<Dev> {
  const env = options.env ?? process.env;
  const root = path.resolve(options.root);
  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    scripts = pkg.scripts ?? {};
  } catch {
    // A root with no package.json has no scripts.
  }
  const command = devCommandOf(options.command, scripts);
  if (command.kind === "refused" && !(command.needsPort && options.port !== undefined))
    throw new Error(command.reason);
  const server = command.kind === "found" ? command.server : undefined;
  const config = server?.kind === "vite" ? await viteConfigOf(root, server, env) : {};
  const found: Listen =
    server === undefined
      ? { port: options.port ?? 0, host: "localhost", https: false, allowedHosts: [] }
      : listenOf(server, env, config);
  const listen: Listen = {
    ...found,
    port: options.port ?? found.port,
    host: options.host ?? found.host,
  };
  if (listen.https)
    throw new Error(
      "The dev server serves HTTPS, and blueline dev speaks HTTP only. Use the Vite plugin, or a tag by hand (blueline add).",
    );

  // One HTTP handler, for the sockets of each address the page's port is held on.
  const sockets = new Set<Socket | Duplex>();
  const proxy = createServer();
  const servers: Server[] = [];
  const close = async () => {
    const closed = servers.map((each) => new Promise<void>((done) => each.close(() => done())));
    // A socket the browser keeps open would hold the port until its own timeout.
    for (const socket of sockets) socket.destroy();
    await Promise.all(closed);
  };
  // Hold the page's port before the command starts.
  for (const host of hostsOf(listen.host)) {
    // Every address is `::`, with IPv4 too; `0.0.0.0` only when the machine has no IPv6.
    if (host === "0.0.0.0" && servers.length > 0) continue;
    const each = createListener((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      proxy.emit("connection", socket);
    });
    // The first gives the port, when the system chose it.
    const asked = servers[0]?.address();
    const at = typeof asked === "object" && asked !== null ? asked.port : listen.port;
    const held = await listenOn(each, at, host);
    if (held === "taken") {
      await close();
      throw new Error(
        `Port ${String(listen.port)} is taken on ${host}. Stop what uses it, or name another port.`,
      );
    }
    if (held === "listening") servers.push(each);
  }
  if (servers.length === 0)
    throw new Error(`blueline dev cannot listen on ${String(listen.host)}.`);
  const address = servers[0]?.address();
  const port = typeof address === "object" && address !== null ? address.port : listen.port;
  const url = `http://localhost:${String(port)}`;

  // Where the dev server listens, once the preload reports it.
  const folder = mkdtempSync(path.join(tmpdir(), "blueline-dev-"));
  const report = path.join(folder, "listening.json");
  let upstream: Upstream | undefined;
  let waiting: ((up: Upstream | undefined) => void)[] = [];
  let ended = false;
  let lastReport = "";
  const poll = setInterval(() => {
    void readFile(report, "utf8").then(
      (text) => {
        if (text === lastReport) return;
        lastReport = text;
        const said = JSON.parse(text) as { address: string; port: number };
        const host =
          said.address === "::" ? "::1" : said.address === "0.0.0.0" ? "127.0.0.1" : said.address;
        upstream = { host, port: said.port };
        for (const resolve of waiting.splice(0)) resolve(upstream);
      },
      () => undefined,
    );
  }, POLL_MS);
  const nothing = setTimeout(() => {
    if (upstream === undefined && !ended)
      options.say(
        `The dev server has not listened on port ${String(port)} through Node in ${String(REPORT_WAIT_MS / 1000)} s. If it uses another port, run blueline dev --port <its port> -- <command>.`,
      );
  }, REPORT_WAIT_MS);
  const ready = (): Promise<Upstream | undefined> =>
    upstream !== undefined || ended
      ? Promise.resolve(upstream)
      : new Promise((resolve) => waiting.push(resolve));

  const holding: Holding = holdRegistration({
    place: options.place,
    root,
    origin: url,
    files: {},
    warn: options.say,
  });

  /** Blueline's own routes, as the Vite plugin answers them. */
  function blueline(request: IncomingMessage, response: ServerResponse, pathname: string) {
    if (!hostAllowed(request.headers.host, listen) || !fromPage(request.headers))
      return refuse(response, 403);
    const query = (request.url ?? "").slice(pathname.length);
    if (pathname === TAG)
      return void configFile(root).then((file) => {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(
          tagModule({
            overlay: OVERLAY,
            page: { storageKey: "blueline", routes: ROUTES },
            ...(file === undefined ? {} : { config: CONFIG_JS, events: EVENTS }),
          }),
        );
      });
    if (pathname === CONFIG_JS)
      return void (async () => {
        const file = await configFile(root);
        if (file === undefined) return refuse(response, 404);
        const made = await configModule(file, CONFIG_MODULE);
        response.setHeader("cache-control", "no-store");
        if (made.kind === "refused") return refuse(response, 500, made.reason);
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.end(made.text);
      })().catch(() => refuse(response, 500));
    const app = holding.app();
    if (pathname === OVERLAY)
      return forward(options.place.port, "/blueline/overlay.js", request, response);
    if (pathname === CONFIG_MODULE)
      return forward(options.place.port, "/blueline/config.js", request, response);
    if (app === undefined)
      return refuse(response, 503, "Blueline is not registered with its server yet.");
    if (pathname === EVENTS)
      return forward(options.place.port, `${app.base}events`, request, response);
    for (const route of CHANNEL_ROUTES) {
      const at = ROUTES[route];
      if (pathname === at || pathname.startsWith(`${at}/`))
        return forward(
          options.place.port,
          `${app.base}${route}${pathname.slice(at.length)}${query}`,
          request,
          response,
        );
    }
    refuse(response, 404);
  }

  /** Sends a request on to the dev server, with the tag in an HTML answer. */
  async function pass(request: IncomingMessage, response: ServerResponse) {
    const up = await ready();
    if (up === undefined) return refuse(response, 502, "The dev server stopped.");
    const headers = hopless(request.headers);
    const accept = decodable(request.headers["accept-encoding"]);
    if (accept !== undefined) headers["accept-encoding"] = accept;
    // The answer to a page has no validator once it has the tag, so no page from before
    // `blueline dev` comes back from the browser's cache with no tag.
    if (String(request.headers.accept ?? "").includes("text/html")) {
      delete headers["if-none-match"];
      delete headers["if-modified-since"];
    }
    const sent = send(
      { host: up.host, port: up.port, method: request.method, path: request.url, headers },
      (answer) => {
        const status = answer.statusCode ?? 502;
        const out = hopless(answer.headers);
        const codings = decodeList(answer.headers["content-encoding"]);
        const html =
          /^\s*text\/html/i.test(String(answer.headers["content-type"] ?? "")) &&
          hasBody(request.method, status) &&
          codings.every((coding) => coding in DECODERS);
        if (!html) {
          response.writeHead(status, out);
          answer.pipe(response);
        } else {
          for (const name of OF_THE_BYTES) delete out[name];
          response.writeHead(status, out);
          const scanner = tagInHtml(TAG_HTML);
          const tagged = new Transform({
            transform: (chunk: Buffer, _, done) => done(null, scanner.push(chunk)),
            flush: (done) => done(null, scanner.end()),
          });
          // The codings come off in the order opposite to the one they went on in.
          const decoders = [...codings]
            .reverse()
            .map((coding) => DECODERS[coding]?.() ?? new Transform());
          pipeline([answer, ...decoders, tagged, response], (error) => {
            if (error) response.destroy();
          });
        }
        answer.once("close", () => {
          if (!answer.complete) response.destroy();
        });
      },
    );
    sent.on("error", () => {
      if (response.headersSent) return void response.destroy();
      refuse(response, 502, "The dev server did not answer.");
    });
    response.once("close", () => {
      if (!response.writableFinished) sent.destroy();
    });
    request.pipe(sent);
  }

  proxy.on("request", (request: IncomingMessage, response: ServerResponse) => {
    const pathname = (request.url ?? "/").split("?")[0] ?? "/";
    if (pathname.startsWith(PREFIX)) return blueline(request, response, pathname);
    void pass(request, response);
  });

  // A websocket, as Vite's HMR, goes through whole: its handshake, then its two sockets.
  proxy.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    if ((request.url ?? "").startsWith(PREFIX)) return void socket.destroy();
    void ready().then((up) => {
      if (up === undefined) return void socket.destroy();
      const headers = {
        ...hopless(request.headers),
        connection: "Upgrade",
        upgrade: request.headers.upgrade ?? "websocket",
      };
      const sent = send({
        host: up.host,
        port: up.port,
        method: request.method,
        path: request.url,
        headers,
      });
      sent.on("upgrade", (answer, upSocket, upHead) => {
        sockets.add(upSocket);
        upSocket.once("close", () => sockets.delete(upSocket));
        const lines = [`HTTP/1.1 101 ${answer.statusMessage ?? "Switching Protocols"}`];
        const named = hopless(answer.headers);
        for (let i = 0; i < answer.rawHeaders.length; i += 2) {
          const name = answer.rawHeaders[i] ?? "";
          if (name.toLowerCase() in named) lines.push(`${name}: ${answer.rawHeaders[i + 1] ?? ""}`);
        }
        lines.push(
          "Connection: Upgrade",
          `Upgrade: ${String(answer.headers.upgrade ?? "websocket")}`,
        );
        socket.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (upHead.length > 0) socket.write(upHead);
        if (head.length > 0) upSocket.write(head);
        upSocket.on("error", () => socket.destroy());
        upSocket.pipe(socket);
        socket.pipe(upSocket);
        socket.once("close", () => upSocket.destroy());
        upSocket.once("close", () => socket.destroy());
      });
      // The dev server did not take the websocket: its answer goes back, decoded from its
      // chunks, and the socket's end ends the body.
      sent.on("response", (answer) => {
        const lines = [`HTTP/1.1 ${String(answer.statusCode)} ${answer.statusMessage ?? ""}`];
        const kept = hopless(answer.headers);
        for (let i = 0; i < answer.rawHeaders.length; i += 2) {
          const name = answer.rawHeaders[i] ?? "";
          if (name.toLowerCase() in kept) lines.push(`${name}: ${answer.rawHeaders[i + 1] ?? ""}`);
        }
        lines.push("Connection: close");
        socket.write(`${lines.join("\r\n")}\r\n\r\n`);
        answer.pipe(socket);
      });
      sent.on("error", () => socket.destroy());
      sent.end();
    });
  });

  // The guard starts the command in a group of its own.
  const preload = hookFile();
  const given = {
    command: options.command,
    cwd: root,
    env: {
      NODE_OPTIONS: `--require ${JSON.stringify(preload)}${env["NODE_OPTIONS"] ? ` ${env["NODE_OPTIONS"]}` : ""}`,
      BLUELINE_DEV_PORT: String(port),
      BLUELINE_DEV_REPORT: report,
      PATH: [...binsOf(root), env["PATH"] ?? ""].join(path.delimiter),
    },
  };
  const guard = spawn(process.execPath, [guardFile(), JSON.stringify(given)], {
    detached: true,
    env: Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    stdio: ["pipe", "inherit", "inherit", "pipe"],
  });
  const control = guard.stdin;
  if (control === null) throw new Error("The guard has no stdin.");
  // A guard that is gone is handled at its exit.
  control.on("error", () => undefined);
  let exitCode = 1;
  let doneWith: (code: number) => void = () => undefined;
  const finished = new Promise<number>((done) => (doneWith = done));
  let stopping: Promise<number> | undefined;

  const stop = () => {
    stopping ??= (async () => {
      ended = true;
      clearInterval(poll);
      clearTimeout(nothing);
      for (const resolve of waiting.splice(0)) resolve(undefined);
      waiting = [];
      holding.stop();
      await close();
      if (guard.exitCode === null && guard.signalCode === null) {
        control.write("stop\n");
        await new Promise<void>((done) => {
          guard.once("exit", () => done());
          if (guard.exitCode !== null || guard.signalCode !== null) done();
        });
      }
      rmSync(folder, { recursive: true, force: true });
      return exitCode;
    })();
    return stopping;
  };

  let said = "";
  const events = guard.stdio[3] as NodeJS.ReadableStream | null;
  events?.setEncoding("utf8");
  events?.on("data", (chunk: string) => {
    said += chunk;
    for (let end = said.indexOf("\n"); end !== -1; end = said.indexOf("\n")) {
      const event = JSON.parse(said.slice(0, end)) as GuardEvent;
      said = said.slice(end + 1);
      if (event.failed !== undefined) {
        options.say(`The command did not start: ${event.failed}`);
        exitCode = 127;
      }
      if (event.exit === true) {
        exitCode = codeOf(event.code, event.signal);
        void stop().then(doneWith);
      }
    }
  });
  guard.once("exit", () => {
    void stop().then(doneWith);
  });
  control.write("go\n");

  return {
    port,
    url,
    ended: finished,
    stop: async () => {
      const code = await stop();
      doneWith(code);
      return code;
    },
  };
}
