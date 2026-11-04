import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inputInside, inside } from "../examples/review-demo/inside.ts";

/* The demo agents' file guard judges a path by where it really is. */

function folders() {
  const top = mkdtempSync(path.join(tmpdir(), "inside-"));
  const root = path.join(top, "repo");
  const outside = path.join(top, "secret");
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(outside, "key.txt"), "x");
  symlinkSync(outside, path.join(root, "link"));
  return { root, outside };
}

describe("inside", () => {
  it("takes a file in the folder, and a new one", () => {
    const { root } = folders();
    expect(inside(root, "src/app.ts")).toBe(true);
    expect(inside(root, path.join(root, "src/new/deep.ts"))).toBe(true);
  });

  it("refuses a symbolic link that points outside, also for a new file under it", () => {
    const { root } = folders();
    expect(inside(root, "link/key.txt")).toBe(false);
    expect(inside(root, "link/new.txt")).toBe(false);
  });

  it("refuses a path out, node_modules and .git", () => {
    const { root, outside } = folders();
    expect(inside(root, "../secret/key.txt")).toBe(false);
    expect(inside(root, path.join(outside, "key.txt"))).toBe(false);
    expect(inside(root, "node_modules/x/index.js")).toBe(false);
    expect(inside(root, ".git/config")).toBe(false);
  });

  it("refuses a glob that names another folder", () => {
    const { root } = folders();
    expect(inputInside(root, "Glob", { pattern: "/etc/*" })).toBe(false);
    expect(inputInside(root, "Glob", { pattern: "../**/*.ts" })).toBe(false);
    expect(inputInside(root, "Glob", { pattern: "src/**/*.ts" })).toBe(true);
    expect(inputInside(root, "Grep", { pattern: "x", glob: "../**/*" })).toBe(false);
  });

  it("takes any text that Grep looks for", () => {
    const { root } = folders();
    expect(inputInside(root, "Grep", { pattern: "/__agent", path: "." })).toBe(true);
    expect(inputInside(root, "Grep", { pattern: "\\.\\./x" })).toBe(true);
  });
});
