import { execFile } from "node:child_process";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import {
  CACHE_MINUTES,
  CLAUDE_ROOT,
  mcpCommand,
  mcpTable,
  sharedInvocation,
  ourHooks,
  timesFor,
  withMcpTable,
  withOurHooks,
  type Hooks,
  type Invocation,
} from "../src/deliver/setup.ts";
import {
  RepositoryStartFile,
  repositoryStartPath,
  StartsFile,
  startsPath,
  type Start,
  type Starts,
} from "./deliver.ts";
import type { Command } from "./lines.ts";
import { feedbackOf, PLACE, repositoryOf } from "./repository.ts";
import { readFile, writeWhole } from "./wire.ts";

/*
 * `blueline setup <claude|codex>`, run in a repository: the harness's hooks, Blueline's MCP
 * server, and how the server starts a fresh agent there (ADR 0005). It writes only its own
 * entries, and leaves the others as they are. Run again, it changes nothing; `--remove` takes
 * its entries out. Every time it writes follows from one cache lifetime (src/deliver/setup.ts).
 */

type SetupCommand = Extract<Command, { kind: "setup" }>;

const JsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown), {
  space: 2,
});

/** How the harness runs this command: the repository's own `blueline`, or this script. */
const invocationIn = Effect.fn(function* (repository: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const local = path.join(repository, "node_modules", ".bin", "blueline");
  if (yield* fs.exists(local)) return { command: local, prefix: [] } satisfies Invocation;
  const script = yield* fs.realPath(process.argv[1] ?? "");
  return { command: process.execPath, prefix: [script] } satisfies Invocation;
});

const run = (command: string, args: readonly string[], cwd: string) =>
  Effect.callback<{ readonly code: number; readonly stderr: string }>((resume) => {
    execFile(command, args, { cwd }, (error, _, stderr) =>
      resume(
        Effect.succeed({
          code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stderr,
        }),
      ),
    );
  });

/** A JSON file's object, or an empty one for a missing file; one that does not read fails, so
 * setup never writes over what it cannot read. */
const readObject = (file: string) =>
  readFile(file, JsonObject, {}).pipe(
    Effect.mapError((error) => `${file} does not read as JSON: ${String(error)}`),
  );

const hooksIn = (settings: Readonly<Record<string, unknown>>): Hooks => {
  const hooks = settings["hooks"];
  return typeof hooks === "object" && hooks !== null ? (hooks as Hooks) : {};
};

/** A path in the repository as one from its root; one outside it fails. */
const fromRoot = Effect.fn(function* (repository: string, file: string) {
  const path = yield* Path.Path;
  const relative = path.relative(repository, file);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    return yield* Effect.fail(`${file} is not in the repository ${repository}.`);
  return relative.split(path.sep).join("/");
});

export const setup = Effect.fn(function* (command: SetupCommand) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repository = yield* repositoryOf(command.root);
  if (repository === undefined)
    return yield* Effect.fail(`${command.root} is not in a git repository.`);
  const times = timesFor(command.cacheMinutes ?? CACHE_MINUTES[command.harness]);
  const { shared } = command;
  const invocation = shared ? sharedInvocation() : yield* invocationIn(repository);
  const given =
    command.feedback === undefined ? undefined : path.resolve(command.root, command.feedback);
  const feedback = given === undefined || !shared ? given : yield* fromRoot(repository, given);
  // Claude Code names the project's root to its hooks.
  const hookInvocation =
    shared && command.harness === "claude" ? sharedInvocation(CLAUDE_ROOT) : invocation;
  const options = {
    harness: command.harness,
    invocation: hookInvocation,
    name: command.name,
    feedback,
    times,
  };
  const said: string[] = [];

  // The MCP server needs one feedback file: the one named, the app's, or the default.
  const app = (yield* feedbackOf(repository))[0];
  const mcpFeedback = shared
    ? (feedback ??
      (app === undefined
        ? undefined
        : yield* fromRoot(repository, app).pipe(Effect.orElseSucceed(() => undefined))) ??
      ".blueline/feedback.jsonl")
    : (feedback ?? app ?? path.join(repository, ".blueline", "feedback.jsonl"));
  const mcp = mcpCommand(invocation, [
    "mcp",
    mcpFeedback,
    "--wait",
    String(times.waitSeconds),
    ...(command.name === "agent" ? [] : ["--as", command.name]),
  ]);

  /** Writes a JSON file's object as `change` makes it, or removes the file it leaves empty. */
  const rewrite = Effect.fn(function* (
    file: string,
    change: (was: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>,
  ) {
    const next = change(yield* readObject(file));
    if (Object.keys(next).length === 0) {
      if (yield* fs.exists(file)) yield* fs.remove(file);
      return;
    }
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* writeWhole(file, `${yield* Schema.encodeEffect(JsonObject)(next)}\n`);
  });

  if (command.harness === "claude") {
    const file = path.join(repository, ".claude", shared ? "settings.json" : "settings.local.json");
    yield* rewrite(file, (settings) => {
      const hooks = withOurHooks(hooksIn(settings), command.remove ? {} : ourHooks(options));
      const { hooks: _, enabledMcpjsonServers: enabled, ...rest } = settings;
      // Claude Code asks before it runs a server of `.mcp.json`; the repository says yes.
      // Only the shared setup touches the list: a user's own `.mcp.json` server stays allowed.
      const servers = Array.isArray(enabled) ? enabled.filter((s) => s !== "blueline") : [];
      const allowed = !shared
        ? enabled
        : command.remove
          ? servers.length === 0
            ? undefined
            : servers
          : [...servers, "blueline"];
      return {
        ...rest,
        ...(Object.keys(hooks).length === 0 ? {} : { hooks }),
        ...(allowed === undefined ? {} : { enabledMcpjsonServers: allowed }),
      };
    });
    said.push(
      `${command.remove ? "Took Blueline's hooks out of" : "Wrote Blueline's hooks to"} ${file}.`,
    );
    if (shared) {
      const mcpFile = path.join(repository, ".mcp.json");
      yield* rewrite(mcpFile, (was) => {
        const servers = was["mcpServers"];
        const { blueline: _, ...others } =
          typeof servers === "object" && servers !== null
            ? (servers as Readonly<Record<string, unknown>>)
            : {};
        const next = command.remove ? others : { ...others, blueline: { ...mcp } };
        const { mcpServers: __, ...rest } = was;
        return Object.keys(next).length === 0 ? rest : { ...rest, mcpServers: next };
      });
      said.push(
        `${command.remove ? "Took the blueline MCP server out of" : "Wrote the blueline MCP server to"} ${mcpFile}.`,
      );
    } else {
      // The MCP server in the user's local scope for this project, so no checked-in file holds
      // a path of this machine. Removed first, so a second run writes the same.
      yield* run("claude", ["mcp", "remove", "--scope", "local", "blueline"], repository);
      if (!command.remove) {
        const added = yield* run(
          "claude",
          ["mcp", "add", "--scope", "local", "blueline", "--", mcp.command, ...mcp.args],
          repository,
        );
        said.push(
          added.code === 0
            ? "Added the blueline MCP server to Claude Code for this project."
            : `Could not add the MCP server: ${added.stderr.trim()}. Run: claude mcp add --scope local blueline -- ${[mcp.command, ...mcp.args].join(" ")}`,
        );
      }
    }
  } else {
    const hooksFile = path.join(repository, ".codex", "hooks.json");
    yield* rewrite(hooksFile, (settings) => {
      const hooks = withOurHooks(hooksIn(settings), command.remove ? {} : ourHooks(options));
      const { hooks: _, ...rest } = settings;
      return Object.keys(hooks).length === 0 ? rest : { ...rest, hooks };
    });
    const configFile = path.join(repository, ".codex", "config.toml");
    const toml = (yield* fs.exists(configFile)) ? yield* fs.readFileString(configFile) : "";
    const table = command.remove ? undefined : mcpTable(mcp.command, mcp.args, times);
    const nextToml = withMcpTable(toml, table);
    // A file that holds nothing but Blueline's table goes when the table does.
    if (nextToml === "") {
      if (yield* fs.exists(configFile)) yield* fs.remove(configFile);
    } else {
      yield* fs.makeDirectory(path.dirname(configFile), { recursive: true });
      yield* writeWhole(configFile, nextToml);
    }
    said.push(
      `${command.remove ? "Took Blueline out of" : "Wrote Blueline's hooks and MCP server to"} ${hooksFile} and ${configFile}.`,
      "Codex loads a project's .codex/ only once you trust the project: open it in Codex and accept.",
    );
  }

  // How the server starts a fresh agent for this repository: in the file it commits, or in the
  // user's own settings in the state folder.
  const entryOf = (was: { readonly start?: Start | undefined } | undefined) => {
    const start: Start | undefined = command.remove ? undefined : (command.start ?? was?.start);
    return {
      ...(start === undefined ? {} : { start }),
      ...(command.name === "agent" ? {} : { as: command.name }),
    };
  };
  let start: Start | undefined;
  if (shared) {
    const file = repositoryStartPath(repository);
    const was = yield* readFile(file, RepositoryStartFile, {});
    const entry = entryOf(was);
    start = entry.start;
    if (command.remove || Object.keys(entry).length === 0) {
      if (yield* fs.exists(file)) yield* fs.remove(file);
    } else yield* writeWhole(file, `${yield* Schema.encodeEffect(RepositoryStartFile)(entry)}\n`);
  } else {
    const { state } = yield* PLACE;
    const startsFile = startsPath(state);
    const starts = yield* readFile(startsFile, StartsFile, {});
    const entry = entryOf(starts[repository]);
    start = entry.start;
    const nextStarts: Starts = Object.fromEntries(
      Object.entries({ ...starts, [repository]: entry }).filter(
        ([, e]) => e.start !== undefined || e.as !== undefined,
      ),
    );
    yield* fs.makeDirectory(state, { recursive: true });
    yield* writeWhole(startsFile, `${yield* Schema.encodeEffect(StartsFile)(nextStarts)}\n`);
  }
  if (start !== undefined)
    said.push(`With no agent on the review, the server starts one by ${start.adapter}.`);
  said.push(
    `The prompt cache counts as warm for ${String(times.warmMinutes)} minutes; a wait lasts up to ${String(times.waitSeconds)} s.`,
  );
  yield* Console.log(said.join("\n"));
});
