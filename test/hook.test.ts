import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { freePort } from "./helpers/apps";
import { folder } from "./helpers/dev";

/*
 * The preload of `blueline dev` (src/server/hook.ts): a listen on the page's port listens on
 * a port that the system gives, reports it, and its `address()` gives the page's port.
 */

const run = promisify(execFile);
const HOOK = path.join(import.meta.dirname, "..", "src", "server", "hook.ts");
const TWICE = path.join(import.meta.dirname, "fixtures", "listen-twice.ts");

describe("the preload", () => {
  it("reports the real port again when a server listens a second time", async () => {
    const page = await freePort();
    const { stdout } = await run(process.execPath, ["--require", HOOK, TWICE], {
      env: {
        ...process.env,
        BLUELINE_DEV_PORT: String(page),
        BLUELINE_DEV_REPORT: path.join(folder("hook"), "listening.json"),
      },
    });
    const said = JSON.parse(stdout) as { first: number; second: number; address: number };
    expect(said.first).not.toBe(page);
    expect(said.second).not.toBe(page);
    expect(said.address).toBe(page);
  });
});
