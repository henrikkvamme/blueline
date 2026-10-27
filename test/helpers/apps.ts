import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer, connect } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

/*
 * Apps for the tests of `blueline dev` with real dev servers, and the command run as a
 * process of its own. Each app is a folder in `test/.apps/`, so its commands find the
 * repository's `node_modules`.
 */

const run = promisify(execFile);
const APPS = path.join(import.meta.dirname, "..", ".apps");
export const BIN = path.join(import.meta.dirname, "..", "..", "bin", "blueline.ts");

/** A new app folder with these files. */
export function app(name: string, files: Record<string, string>) {
  mkdirSync(APPS, { recursive: true });
  const root = mkdtempSync(path.join(APPS, `${name}-`));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

export async function freePort() {
  const server = createNetServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise((done) => server.close(done));
  if (typeof address !== "object" || address === null) throw new Error("No port");
  return address.port;
}

/** Whether something takes connections on `port`, on the loopback address of either family. */
export async function listening(port: number) {
  const on = (host: string) =>
    new Promise<boolean>((done) => {
      const socket = connect({ port, host });
      socket.once("connect", () => {
        socket.destroy();
        done(true);
      });
      socket.once("error", () => done(false));
    });
  return (await on("127.0.0.1")) || (await on("::1"));
}

export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Waits until `check` holds, or fails after `ms`. */
export async function until(check: () => Promise<boolean> | boolean, ms: number, what: string) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await check()) return;
  throw new Error(`${what} did not happen in ${String(ms)} ms.`);
}

export interface Running {
  readonly child: ChildProcess;
  /** What it wrote so far, both streams. */
  readonly output: () => string;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** `blueline dev` as its own process, in `root`, on the server at `place`. */
export function blueline(
  root: string,
  args: readonly string[],
  place: { port: number; state: string },
  env: Record<string, string> = {},
): Running {
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd: root,
    env: {
      ...process.env,
      BLUELINE_PORT: String(place.port),
      BLUELINE_STATE: place.state,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );
  return { child, output: () => output, exited };
}

interface Proc {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
}

async function processes(): Promise<Proc[]> {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,pgid="]);
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .map(([pid = 0, ppid = 0, pgid = 0]) => ({ pid, ppid, pgid }));
}

/** The processes under `pid`, and their groups. */
export async function tree(pid: number) {
  const all = await processes();
  const found: Proc[] = [];
  const next = [pid];
  while (next.length > 0) {
    const parent = next.pop();
    for (const each of all)
      if (each.ppid === parent) {
        found.push(each);
        next.push(each.pid);
      }
  }
  return { pids: found.map((p) => p.pid), groups: [...new Set(found.map((p) => p.pgid))] };
}

/** The processes still alive among `pids`, or in `groups`. */
export async function left(pids: readonly number[], groups: readonly number[]) {
  const all = await processes();
  return all.filter((p) => pids.includes(p.pid) || groups.includes(p.pgid));
}

/** The TCP ports that `pids` listen on. */
export async function portsOf(pids: readonly number[]) {
  if (pids.length === 0) return [];
  const { stdout } = await run("lsof", [
    "-nP",
    "-a",
    "-iTCP",
    "-sTCP:LISTEN",
    "-p",
    pids.join(","),
  ]).catch(() => ({ stdout: "" }));
  return [...new Set([...stdout.matchAll(/:(\d+) \(LISTEN\)/g)].map((m) => Number(m[1])))];
}
