import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/*
 * `blueline setup --shared`: the files a repository commits, so every clone and worktree has
 * the delivery (ADR 0005) with no setup of its own. They hold no path of one machine, and a
 * second run writes the same.
 */

const COMMAND = path.join(import.meta.dirname, "..", "bin", "blueline.ts");

let dir = "";

/** No harness of the machine's own takes part. */
const env = (more: Record<string, string> = {}) => {
  const { CLAUDE_PID: _, T3CODE_CLI_PATH: __, ...rest } = process.env;
  return { ...rest, BLUELINE_STATE: path.join(dir, "state"), ...more };
};
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A repository with the package's `blueline` in its `node_modules/.bin`, as an install has. */
function repository() {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "blueline-shared-")));
  mkdirSync(path.join(dir, ".git"));
  const bin = path.join(dir, "node_modules", ".bin", "blueline");
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(
    bin,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(COMMAND)} "$@"\n`,
  );
  chmodSync(bin, 0o755);
}

const setup = (...args: string[]) => {
  const ran = spawnSync(process.execPath, [COMMAND, "setup", ...args], {
    cwd: dir,
    env: env({ PATH: "/usr/bin:/bin" }),
    encoding: "utf8",
  });
  expect(ran.stderr).toBe("");
  expect(ran.status).toBe(0);
  return ran.stdout;
};

/** The files setup wrote, by path from the root, without the shim and the state. */
function written() {
  const files: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const file = path.join(at, name);
      const from = path.relative(dir, file);
      if (["node_modules", ".git", "state"].includes(from)) continue;
      if (statSync(file).isDirectory()) walk(file);
      else files[from] = readFileSync(file, "utf8");
    }
  };
  walk(dir);
  return files;
}

const json = (file: string) =>
  JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;

describe("shared setup", { timeout: 30_000 }, () => {
  it("writes Claude's committed files with no path of this machine, the same each run", () => {
    repository();
    writeFileSync(
      path.join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } } }),
    );
    mkdirSync(path.join(dir, ".claude"));
    writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    setup("claude", "--shared", "--start", "t3", "--feedback", "docs/review/feedback.jsonl");
    const once = written();
    expect(Object.keys(once).sort()).toEqual([
      ".blueline.json",
      ".claude/settings.json",
      ".mcp.json",
    ]);
    for (const text of Object.values(once)) {
      expect(text).not.toContain(dir);
      expect(text).not.toContain(homedir());
      expect(text).not.toContain(process.execPath);
    }
    expect(json(".blueline.json")).toEqual({ start: { adapter: "t3" } });
    expect(json(".mcp.json")).toEqual({
      mcpServers: {
        other: { command: "other" },
        blueline: {
          command: "sh",
          args: [
            "-c",
            'cd "$(git rev-parse --show-toplevel)" && exec node_modules/.bin/blueline mcp docs/review/feedback.jsonl --wait 3540',
          ],
        },
      },
    });
    const settings = json(".claude/settings.json") as {
      model: string;
      enabledMcpjsonServers: string[];
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    expect(settings.model).toBe("opus");
    expect(settings.enabledMcpjsonServers).toEqual(["blueline"]);
    expect(settings.hooks["Stop"]?.flatMap((g) => g.hooks.map((h) => h.command))).toEqual([
      'cd "$CLAUDE_PROJECT_DIR" && exec node_modules/.bin/blueline hook claude --warm 59 --feedback docs/review/feedback.jsonl',
      'cd "$CLAUDE_PROJECT_DIR" && exec node_modules/.bin/blueline wait --feedback docs/review/feedback.jsonl',
    ]);
    // No user setting: no start file in the state folder, and no `claude mcp add`.
    expect(existsSync(path.join(dir, "state", "start.json"))).toBe(false);
    setup("claude", "--shared", "--feedback", "docs/review/feedback.jsonl");
    expect(written()).toEqual(once);
    // Taken out, the files hold only what was there before.
    setup("claude", "--shared", "--remove");
    expect(written()).toEqual({
      ".claude/settings.json": `${JSON.stringify({ model: "opus" }, null, 2)}\n`,
      ".mcp.json": `${JSON.stringify({ mcpServers: { other: { command: "other" } } }, null, 2)}\n`,
    });
  });

  it("writes hooks that run from any folder of the repository, as Claude Code runs them", () => {
    repository();
    setup("claude", "--shared", "--feedback", ".blueline/feedback.jsonl");
    const settings = json(".claude/settings.json") as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const start = settings.hooks["SessionStart"]?.[0]?.hooks[0]?.command ?? "";
    const sub = path.join(dir, "apps", "web");
    mkdirSync(sub, { recursive: true });
    const ran = spawnSync("sh", ["-c", start], {
      cwd: sub,
      env: env({ CLAUDE_PROJECT_DIR: dir }),
      input: JSON.stringify({ session_id: "s1", cwd: sub, hook_event_name: "SessionStart" }),
      encoding: "utf8",
    });
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(existsSync(path.join(dir, ".blueline", "feedback.jsonl.agents.json"))).toBe(true);
  });

  it("runs a hook on the worktree the session went into, not the project's first root", () => {
    repository();
    setup("claude", "--shared", "--feedback", ".blueline/feedback.jsonl");
    const settings = json(".claude/settings.json") as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const start = settings.hooks["SessionStart"]?.[0]?.hooks[0]?.command ?? "";
    // The project began in `first`; the session went into `dir`, as a worktree.
    const first = dir;
    const worktree = realpathSync(mkdtempSync(path.join(tmpdir(), "blueline-worktree-")));
    mkdirSync(path.join(worktree, ".git"));
    try {
      const ran = spawnSync("sh", ["-c", start], {
        cwd: worktree,
        env: env({ CLAUDE_PROJECT_DIR: first }),
        input: JSON.stringify({ session_id: "s1", cwd: worktree, hook_event_name: "SessionStart" }),
        encoding: "utf8",
      });
      expect(ran.stderr).toBe("");
      expect(ran.status).toBe(0);
      expect(existsSync(path.join(worktree, ".blueline", "feedback.jsonl.agents.json"))).toBe(true);
      expect(existsSync(path.join(first, ".blueline", "feedback.jsonl.agents.json"))).toBe(false);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("leaves no Codex file it made once it is taken out", () => {
    repository();
    setup("codex", "--shared");
    setup("codex", "--shared", "--remove");
    expect(written()).toEqual({});
  });

  it("leaves a user's own setup the MCP servers the repository allows", () => {
    repository();
    mkdirSync(path.join(dir, ".claude"));
    const allowed = { enabledMcpjsonServers: ["blueline", "other"] };
    writeFileSync(path.join(dir, ".claude", "settings.local.json"), JSON.stringify(allowed));
    // No `claude` on the PATH: setup says how to add the server, and goes on.
    const ran = spawnSync(process.execPath, [COMMAND, "setup", "claude"], {
      cwd: dir,
      env: env({ PATH: "/usr/bin:/bin" }),
      encoding: "utf8",
    });
    expect(ran.status).toBe(0);
    expect(json(".claude/settings.local.json")["enabledMcpjsonServers"]).toEqual([
      "blueline",
      "other",
    ]);
  });

  it("writes Codex's committed files with no path of this machine", () => {
    repository();
    setup("codex", "--shared", "--start", "codex", "--as", "review");
    const files = written();
    expect(Object.keys(files).sort()).toEqual([
      ".blueline.json",
      ".codex/config.toml",
      ".codex/hooks.json",
    ]);
    for (const text of Object.values(files)) expect(text).not.toContain(dir);
    expect(files[".codex/config.toml"]).toContain(
      'args = ["-c", "cd \\"$(git rev-parse --show-toplevel)\\" && exec node_modules/.bin/blueline mcp .blueline/feedback.jsonl --wait 1740 --as review"]',
    );
    expect(files[".codex/hooks.json"]).toContain(
      'cd \\"$(git rev-parse --show-toplevel)\\" && exec node_modules/.bin/blueline hook codex --warm 29 --as review',
    );
    expect(json(".blueline.json")).toEqual({ start: { adapter: "codex" }, as: "review" });
    setup("codex", "--shared", "--as", "review");
    expect(written()).toEqual(files);
  });

  it("takes a feedback file only in the repository", () => {
    repository();
    const ran = spawnSync(
      process.execPath,
      [COMMAND, "setup", "claude", "--shared", "--feedback", "/tmp/elsewhere.jsonl"],
      {
        cwd: dir,
        env: { ...process.env, BLUELINE_STATE: path.join(dir, "state") },
        encoding: "utf8",
      },
    );
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toContain("is not in the repository");
  });
});
