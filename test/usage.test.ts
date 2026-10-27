import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* The command's usage: asked for, or after a command line it does not take. */

const COMMAND = path.join(import.meta.dirname, "..", "bin", "blueline.ts");
const blueline = (...args: string[]) =>
  spawnSync(process.execPath, [COMMAND, ...args], { encoding: "utf8" });

describe("the usage", () => {
  it("prints on --help, to the output, and exits 0", () => {
    const ran = blueline("--help");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("Usage:");
    expect(ran.stderr).toBe("");
  });

  it("prints after a command line it does not take, with no error log, and exits 2", () => {
    const ran = blueline("nope");
    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain("Usage:");
    expect(ran.stderr).not.toContain("ERROR");
  });
});
