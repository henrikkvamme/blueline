import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ensureServer, older, stopServer, type Place } from "../src/server/start";
import { folder } from "./helpers/dev";

/*
 * Starting `blueline serve` from a dev server or a command, as its own process, and the
 * commands that keep an origin for a tag by hand.
 */

const run = promisify(execFile);
const COMMAND = path.join(import.meta.dirname, "..", "bin", "blueline.ts");

/** A port no one listens on. */
async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise((done) => server.close(done));
  if (typeof address !== "object" || address === null) throw new Error("No port");
  return address.port;
}

const places: Place[] = [];
afterEach(async () => {
  for (const place of places.splice(0)) await stopServer(place).catch(() => undefined);
});

async function place(): Promise<Place> {
  const made = { port: await freePort(), state: folder("start") };
  places.push(made);
  return made;
}

describe("starting blueline serve", () => {
  it("starts one when none runs, as a process of its own, and uses it after", async () => {
    const at = await place();
    const health = await ensureServer(at);
    expect(health).toMatchObject({ blueline: true, protocol: 2 });
    expect(health.pid).not.toBe(process.pid);
    expect(await ensureServer(at)).toEqual(health);
    expect(readFileSync(path.join(at.state, "serve.log"), "utf8")).toContain("serves every app");
  });

  it("keeps a state folder given from here in that folder", async () => {
    const at = await place();
    await ensureServer({ port: at.port, state: path.relative(process.cwd(), at.state) });
    expect(readdirSync(at.state).sort()).toEqual(["apps.json", "serve.log"]);
  });

  it("keeps no file open in this process for each start", async () => {
    const at = await place();
    mkdirSync(at.state, { recursive: true });
    writeFileSync(path.join(at.state, "apps.json"), "{nope");
    const log = path.join(at.state, "serve.log");
    // The files this process has open, by name.
    const open = async () => (await run("lsof", ["-p", String(process.pid), "-Fn"])).stdout;
    for (const _ of [1, 2, 3]) await expect(ensureServer(at)).rejects.toThrow(log);
    expect(await open()).not.toContain(log);
  });

  it("starts one when two ask at once", async () => {
    const at = await place();
    const [one, two] = await Promise.all([ensureServer(at), ensureServer(at)]);
    expect(one.pid).toBe(two.pid);
  });

  it("stops a server of an older Blueline and starts in its place, and keeps a newer one", async () => {
    const at = await place();
    const first = await ensureServer(at);
    // A newer Blueline asks: the one that runs is older, so it stops.
    const second = await ensureServer(at, "99.0.0");
    expect(second.pid).not.toBe(first.pid);
    // An older Blueline asks: the one that runs is newer, so it stays.
    expect((await ensureServer(at, "0.0.1")).pid).toBe(second.pid);
  });

  it("orders versions by major, minor and patch", () => {
    expect(older("0.1.4", "0.1.6")).toBe(true);
    expect(older("0.1.10", "0.1.9")).toBe(false);
    expect(older("0.2.0", "0.1.9")).toBe(false);
    expect(older("0.1.6", "0.1.6")).toBe(false);
    expect(older("1.0.0", "0.9.9")).toBe(false);
  });

  it("names the log when the server does not start", async () => {
    const at = await place();
    mkdirSync(at.state, { recursive: true });
    writeFileSync(path.join(at.state, "apps.json"), "{nope");
    await expect(ensureServer(at)).rejects.toThrow(path.join(at.state, "serve.log"));
    expect(readFileSync(path.join(at.state, "serve.log"), "utf8")).toContain("does not hold");
  });
});

describe("the commands", () => {
  const blueline = (at: Place, ...args: string[]) =>
    run(process.execPath, [COMMAND, ...args], {
      env: { ...process.env, BLUELINE_PORT: String(at.port), BLUELINE_STATE: at.state },
    });

  it("keep an origin and print its tag, remove it, and stop the server", async () => {
    const at = await place();
    const root = folder("hand");
    const added = await blueline(at, "add", "http://localhost:3000", "--root", root);
    expect(added.stdout).toMatch(
      new RegExp(
        `<script type="module" src="http://127.0.0.1:${String(at.port)}/blueline/[\\w-]+/tag.js"></script>`,
      ),
    );
    const removed = await blueline(at, "remove", "http://localhost:3000", "--root", root);
    expect(removed.stdout).toContain("no longer uses");
    await expect(blueline(at, "remove", "http://localhost:3000", "--root", root)).rejects.toThrow(
      /is not kept/,
    );
    expect((await blueline(at, "serve", "stop")).stdout).toContain("stopped");
    expect((await blueline(at, "serve", "stop")).stdout).toContain("No Blueline server runs");
  });
});
