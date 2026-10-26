import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import type { GivenFiles } from "./apps.ts";
import { commandFile } from "./package.ts";
import { PORT, probe, type Health, type Registered } from "./serve.ts";

/*
 * The side of a dev server or a command that uses `blueline serve`: it starts the server when
 * none runs, and keeps a dev server's registration open, again after the server restarts.
 */

const START_MS = 5000;
const RETRY_MS = 1000;
const RETRY_MAX_MS = 30_000;

/** Where `blueline serve` runs, and where it keeps its apps. */
export interface Place {
  readonly port: number;
  readonly state: string;
}

/** The server's place from the environment: `BLUELINE_PORT`, `BLUELINE_STATE`, or the
 * user's state folder. */
export function placeOf(env: Readonly<Record<string, string | undefined>>): Place {
  const port = Number(env["BLUELINE_PORT"] ?? PORT);
  const states = env["XDG_STATE_HOME"] ?? path.join(env["HOME"] ?? ".", ".local", "state");
  return {
    port: Number.isInteger(port) && port > 0 ? port : PORT,
    state: env["BLUELINE_STATE"] ?? path.join(states, "blueline"),
  };
}

/**
 * The running server's health. When none runs, starts one as a process of its own, which
 * outlives this one, with its output in `serve.log`, and waits for it.
 */
export async function ensureServer({ port, state: given }: Place): Promise<Health> {
  // The server runs in its state folder, so a folder from here must be whole first.
  const place = { port, state: path.resolve(given) };
  const found = await probe(place.port);
  if (found.kind === "blueline") return found.health;
  if (found.kind === "other") throw new Error(found.reason);
  mkdirSync(place.state, { recursive: true });
  const log = path.join(place.state, "serve.log");
  const out = openSync(log, "a");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [commandFile(), "serve"], {
      detached: true,
      // The server does not hang on to the folder it was started from.
      cwd: place.state,
      stdio: ["ignore", out, out],
      env: { ...process.env, BLUELINE_PORT: String(place.port), BLUELINE_STATE: place.state },
    });
  } finally {
    // The child has its own copy; this process keeps none for each start.
    closeSync(out);
  }
  const failed = new Promise<string>((done) => {
    child.once("error", (error) => done(error.message));
    child.once("exit", (code) => done(`it exited with code ${String(code)}`));
  });
  child.unref();
  for (const until = Date.now() + START_MS; Date.now() < until;) {
    const ready = await Promise.race([
      wait(100).then(() => probe(place.port)),
      failed.then((why) => ({ kind: "failed" as const, why })),
    ]);
    // Another start may have won the port: its server is as good.
    if (ready.kind === "blueline") return ready.health;
    if (ready.kind === "other") throw new Error(ready.reason);
    if (ready.kind === "failed") {
      const again = await probe(place.port);
      if (again.kind === "blueline") return again.health;
      throw new Error(`Blueline's server did not start: ${ready.why}. See ${log}.`);
    }
  }
  throw new Error(`Blueline's server did not answer in ${String(START_MS / 1000)} s. See ${log}.`);
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Sends a request to the server with a JSON body; the answer's status and its stream. */
export function send(port: number, pathname: string, body: unknown) {
  return new Promise<import("node:http").IncomingMessage>((done, fail) => {
    const sent = request({ host: "127.0.0.1", port, path: pathname, method: "POST" }, (answer) =>
      done(answer),
    );
    sent.on("error", fail);
    sent.end(JSON.stringify(body));
  });
}

/** The first line of an answer, as JSON. */
export function firstLine(answer: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((done, fail) => {
    let text = "";
    const read = (chunk: Buffer) => {
      text += chunk.toString("utf8");
      const end = text.indexOf("\n");
      if (end === -1) return;
      answer.off("data", read);
      try {
        done(JSON.parse(text.slice(0, end)));
      } catch (error) {
        fail(error);
      }
    };
    answer.on("data", read);
    answer.once("end", () => {
      try {
        done(JSON.parse(text));
      } catch (error) {
        fail(error);
      }
    });
  });
}

export interface Holding {
  /** The app while the registration is open. */
  readonly app: () => Registered | undefined;
  readonly stop: () => void;
}

export interface HoldOptions {
  readonly place: Place;
  readonly root: string;
  readonly origin: string;
  readonly files?: GivenFiles;
  /** Says why a registration failed; it is made again after a while. */
  readonly warn: (message: string) => void;
}

/**
 * Keeps a dev server registered: starts the server when none runs, registers, and registers
 * again whenever the registration ends while the dev server runs, after one second, then
 * twice as long each time, at most 30 seconds.
 */
export function holdRegistration(options: HoldOptions): Holding {
  let app: Registered | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let open: import("node:http").IncomingMessage | undefined;
  let delay = RETRY_MS;

  const again = () => {
    app = undefined;
    open = undefined;
    if (stopped) return;
    timer = setTimeout(() => void attempt(), delay);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  };

  async function attempt() {
    try {
      await ensureServer(options.place);
      const { root, origin, files } = options;
      const answer = await send(options.place.port, "/blueline/register", { root, origin, files });
      if (stopped) return void answer.destroy();
      if (answer.statusCode !== 200) {
        const said = await firstLine(answer).catch(() => undefined);
        const why = typeof said === "object" && said !== null ? Reflect.get(said, "error") : "";
        throw new Error(`the server answered ${String(answer.statusCode)} ${String(why)}`);
      }
      open = answer;
      answer.once("close", again);
      app = (await firstLine(answer)) as Registered;
      delay = RETRY_MS;
    } catch (error) {
      options.warn(
        `Blueline could not register this dev server: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (open === undefined) again();
    }
  }

  void attempt();
  return {
    app: () => app,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      open?.destroy();
    },
  };
}

/** What the server answered, as JSON, or an error with its words. */
async function answered(port: number, pathname: string, body: unknown): Promise<unknown> {
  const answer = await send(port, pathname, body);
  const said = await firstLine(answer).catch(() => undefined);
  if (answer.statusCode === 200) return said;
  const why = typeof said === "object" && said !== null ? Reflect.get(said, "error") : undefined;
  throw new Error(
    typeof why === "string" ? why : `The server answered ${String(answer.statusCode)}.`,
  );
}

/** The tag a page loads by hand to use the app's channel. */
export const tagFor = (port: number, app: Registered) =>
  `<script type="module" src="http://127.0.0.1:${String(port)}${app.base}tag.js"></script>`;

/** Keeps `origin` for the app at `root`, for a script tag by hand (`blueline add`). */
export async function addOrigin(place: Place, root: string, origin: string): Promise<Registered> {
  await ensureServer(place);
  const app = await answered(place.port, "/blueline/register", {
    root: path.resolve(root),
    origin,
    keep: true,
  });
  return app as Registered;
}

/** Removes a kept origin (`blueline remove`). */
export async function removeOrigin(
  place: Place,
  root: string,
  origin: string,
): Promise<Registered> {
  const found = await probe(place.port);
  if (found.kind !== "blueline")
    throw new Error(
      found.kind === "none"
        ? `No Blueline server runs on port ${String(place.port)}.`
        : found.reason,
    );
  const app = await answered(place.port, "/blueline/remove", { root: path.resolve(root), origin });
  return app as Registered;
}

/** Asks the running server to stop; says whether one ran. */
export async function stopServer(place: Place): Promise<boolean> {
  const found = await probe(place.port);
  if (found.kind === "none") return false;
  if (found.kind === "other") throw new Error(found.reason);
  const answer = await send(place.port, "/blueline/stop", {});
  answer.resume();
  if (answer.statusCode !== 204)
    throw new Error(`The server answered ${String(answer.statusCode)}.`);
  return true;
}
