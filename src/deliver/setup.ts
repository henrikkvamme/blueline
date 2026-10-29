/*
 * What `blueline setup <harness>` writes (bin/setup.ts), without files, so a test can run it:
 * the harness's hooks, and the times that follow from its prompt cache's lifetime. Setup
 * writes only its own entries, and leaves the others as they are; running it again changes
 * nothing, and `--remove` takes its entries out again.
 */

export type Harness = "claude" | "codex";

/** The times that follow from one cache lifetime, so none can disagree (ADR 0005). */
export interface Times {
  /** How long after a request the cache is warm, in minutes: `blueline hook --warm`. */
  readonly warmMinutes: number;
  /** The longest `wait_for_feedback`, in seconds: `blueline mcp --wait`. */
  readonly waitSeconds: number;
  /** The `blueline wait` hook's timeout, in seconds: Claude Code enforces it. */
  readonly waitHookSeconds: number;
  /** Codex's tool timeout for the MCP server, in seconds. */
  readonly toolTimeoutSeconds: number;
}

/** The cache lifetime by default, in minutes: a Claude subscription keeps an hour, and
 * OpenAI's models at least 30 minutes. */
export const CACHE_MINUTES: Readonly<Record<Harness, number>> = { claude: 60, codex: 30 };

export function timesFor(cacheMinutes: number): Times {
  const warmMinutes = Math.max(1, cacheMinutes - 1);
  const waitSeconds = Math.min(warmMinutes * 60, 3540);
  return {
    warmMinutes,
    waitSeconds,
    waitHookSeconds: (warmMinutes + 1) * 60,
    toolTimeoutSeconds: waitSeconds + 10,
  };
}

/** How the harness runs the `blueline` command. */
export interface Invocation {
  readonly command: string;
  /** What comes before the command's own words, as the script for `node`. */
  readonly prefix: readonly string[];
  /** A shell line in place of `command`, for files a repository commits: it goes to the
   * repository's root and runs its own `blueline`, so it holds no path of one machine. The
   * words after it are quoted; it is not. */
  readonly shell?: string;
}

/** The root of the repository, as a shell finds it from any folder in it. */
const GIT_ROOT = `"$(git rev-parse --show-toplevel)"`;

/** The shared invocation: from the root the harness names, or that git finds. Claude Code
 * names the project's root in `CLAUDE_PROJECT_DIR` for its hooks; Codex and the MCP servers
 * have git's. */
export const sharedInvocation = (root = GIT_ROOT): Invocation => ({
  command: "sh",
  prefix: [],
  shell: `cd ${root} && exec node_modules/.bin/blueline`,
});

/** Claude Code's root for a hook. */
export const CLAUDE_ROOT = `"$CLAUDE_PROJECT_DIR"`;

/** The command line of a shared invocation and the command's words. */
const lineOf = (shell: string, words: readonly string[]) => [shell, ...words.map(quoted)].join(" ");

/** How a harness starts the MCP server: the command, and its words. */
export function mcpCommand(
  invocation: Invocation,
  words: readonly string[],
): { readonly command: string; readonly args: readonly string[] } {
  return invocation.shell === undefined
    ? { command: invocation.command, args: [...invocation.prefix, ...words] }
    : { command: "sh", args: ["-c", lineOf(invocation.shell, words)] };
}

/** A hook handler as both harnesses read it. Claude takes `args` (its exec form); Codex takes
 * one command line. */
export interface Handler {
  readonly type: "command";
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeout?: number;
  readonly asyncRewake?: boolean;
}

interface Group {
  readonly matcher?: string;
  readonly hooks: readonly Handler[];
}
export type Hooks = Readonly<Record<string, readonly Group[]>>;

/** The events each harness runs Blueline's hook on. */
const EVENTS: Readonly<Record<Harness, readonly string[]>> = {
  claude: ["SessionStart", "UserPromptSubmit", "PostToolBatch", "Stop", "SessionEnd"],
  codex: ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"],
};

/** A word for a POSIX shell's command line. */
export const quoted = (word: string) =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** Blueline's own handlers: those whose words run `blueline hook` or `blueline wait`. */
export function isOurs(handler: Handler): boolean {
  const words = [handler.command, ...(handler.args ?? [])].join(" ");
  return /\bblueline(\.js|\.ts)?\b.*\s(hook|wait)(\s|$)/.test(words);
}

export interface HookOptions {
  readonly harness: Harness;
  readonly invocation: Invocation;
  readonly name: string;
  readonly feedback: string | undefined;
  readonly times: Times;
}

const handler = (
  { harness, invocation }: HookOptions,
  words: readonly string[],
  extra: Partial<Handler> = {},
): Handler => {
  if (invocation.shell !== undefined)
    return { type: "command", command: lineOf(invocation.shell, words), ...extra };
  const all = [...invocation.prefix, ...words];
  return harness === "claude"
    ? { type: "command", command: invocation.command, args: all, ...extra }
    : { type: "command", command: [invocation.command, ...all].map(quoted).join(" "), ...extra };
};

/** The handlers Blueline adds, by event. */
export function ourHooks(options: HookOptions): Readonly<Record<string, readonly Handler[]>> {
  const { harness, name, feedback, times } = options;
  const common = [
    ...(name === "agent" ? [] : ["--as", name]),
    ...(feedback === undefined ? [] : ["--feedback", feedback]),
  ];
  const hook = handler(options, ["hook", harness, "--warm", String(times.warmMinutes), ...common]);
  return Object.fromEntries(
    EVENTS[harness].map((event) => [
      event,
      event === "Stop" && harness === "claude"
        ? [
            hook,
            // Claude's idle wake: it runs in the background, and its exit code 2 wakes the
            // session.
            handler(options, ["wait", ...common], {
              asyncRewake: true,
              timeout: times.waitHookSeconds,
            }),
          ]
        : [hook],
    ]),
  );
}

/** The hooks with Blueline's own taken out, and `add` put in, each event in its own group. */
export function withOurHooks(
  hooks: Hooks,
  add: Readonly<Record<string, readonly Handler[]>>,
): Hooks {
  const kept: Record<string, readonly Group[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const left = groups
      .map((group): Group => ({ ...group, hooks: group.hooks.filter((h) => !isOurs(h)) }))
      .filter((group) => group.hooks.length > 0);
    if (left.length > 0) kept[event] = left;
  }
  for (const [event, handlers] of Object.entries(add))
    kept[event] = [...(kept[event] ?? []), { hooks: handlers }];
  return kept;
}

/** The table's header as TOML allows it: spaces around the dots, a quoted key and a comment. */
const OUR_TABLE =
  /^\s*\[\s*(mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(blueline|"blueline"|'blueline')\s*\]\s*(#.*)?$/;

/** Codex's `config.toml` with the `[mcp_servers.blueline]` table in place of the one it had;
 * with no table given, without it. Other tables stay as they are. */
export function withMcpTable(toml: string, table: string | undefined): string {
  const lines = toml.split("\n");
  const start = lines.findIndex((l) => OUR_TABLE.test(l));
  let kept = lines;
  if (start >= 0) {
    const after = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
    const end = after < 0 ? lines.length : after;
    kept = [...lines.slice(0, start), ...lines.slice(end)];
  }
  const body = kept.join("\n").replace(/\n+$/, "");
  if (table === undefined) return body === "" ? "" : `${body}\n`;
  return `${body === "" ? "" : `${body}\n\n`}${table}\n`;
}

const tomlString = (value: string) => JSON.stringify(value);

/** The MCP server's table for Codex. */
export function mcpTable(command: string, args: readonly string[], times: Times): string {
  return [
    "[mcp_servers.blueline]",
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    `tool_timeout_sec = ${String(times.toolTimeoutSeconds)}`,
  ].join("\n");
}
