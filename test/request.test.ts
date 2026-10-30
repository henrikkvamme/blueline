import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { commandOf } from "../bin/lines";
import { REPOSITORY } from "../bin/request";

/* `blueline request`: an agent asks for a change to Blueline, as an issue, through `gh`. */

const COMMAND = path.join(import.meta.dirname, "..", "bin", "blueline.ts");

/** A `gh` that keeps its arguments, lists `open` and files issue 7, or fails. */
function fakeGh(open: string, fails = false) {
  const folder = mkdtempSync(path.join(tmpdir(), "gh-"));
  const calls = path.join(folder, "calls");
  writeFileSync(path.join(folder, "open.json"), open);
  const script = fails
    ? `#!/bin/sh\necho "gh: not logged in" >&2\nexit 4\n`
    : `#!/bin/sh
printf '%s\\n' "$@" >> "${calls}"
printf '%s\\n' "@end" >> "${calls}"
if [ "$2" = list ]; then cat "${folder}/open.json"; else echo "https://github.com/${REPOSITORY}/issues/7"; fi
`;
  writeFileSync(path.join(folder, "gh"), script);
  chmodSync(path.join(folder, "gh"), 0o755);
  const blueline = (...args: string[]) =>
    spawnSync(process.execPath, [COMMAND, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${folder}${path.delimiter}${process.env.PATH ?? ""}` },
    });
  const called = () => {
    try {
      return readFileSync(calls, "utf8");
    } catch {
      return "";
    }
  };
  return { blueline, called, folder };
}

describe("a request for a change to Blueline", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  const gh = (open: string, fails = false) => {
    const made = fakeGh(open, fails);
    folders.push(made.folder);
    return made;
  };

  it("takes a title, and words with --body", () => {
    expect(commandOf(["request", " Pins drift ", "--body", "On scroll."])).toEqual({
      kind: "request",
      title: "Pins drift",
      body: "On scroll.",
    });
    expect(commandOf(["request", "Pins drift"])).toEqual({
      kind: "request",
      title: "Pins drift",
      body: undefined,
    });
    expect(commandOf(["request"])).toBeUndefined();
    expect(commandOf(["request", " "])).toBeUndefined();
    expect(commandOf(["request", "Pins drift", "--journey", "j"])).toBeUndefined();
  });

  it("files an issue on Blueline's repository with the version that runs", () => {
    const { blueline, called } = gh("[]");
    const ran = blueline("request", "Pins drift", "--body", "On scroll.");
    expect(ran.status).toBe(0);
    expect(ran.stdout.trim()).toBe(`Requested: https://github.com/${REPOSITORY}/issues/7`);
    expect(REPOSITORY).toBe("henrikkvamme/blueline");
    const create = called().split("@end\n")[1] ?? "";
    expect(create).toContain(
      `create\n--repo\n${REPOSITORY}\n--title\nPins drift\n--body\nOn scroll.`,
    );
    expect(create).toContain(`Blueline ${pkg.version}`);
  });

  it("files nothing when an open issue has the same title", () => {
    const open = JSON.stringify([{ title: "pins drift", url: "https://github.com/x/y/issues/3" }]);
    const { blueline, called } = gh(open);
    const ran = blueline("request", "Pins drift");
    expect(ran.status).toBe(0);
    expect(ran.stdout.trim()).toBe("Already requested: https://github.com/x/y/issues/3");
    expect(called()).not.toContain("create");
  });

  it("prints its help for --help, and files nothing", () => {
    const { blueline, called } = gh("[]");
    const ran = blueline("request", "--help");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("blueline request <title>");
    expect(called()).toBe("");
  });

  it("prints a link that files it when gh cannot, and fails", () => {
    const { blueline } = gh("[]", true);
    const ran = blueline("request", "Pins drift");
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toContain("gh: not logged in");
    expect(ran.stderr).toContain(`https://github.com/${REPOSITORY}/issues/new?title=Pins+drift`);
  });
});
