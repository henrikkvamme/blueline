import { execFile } from "node:child_process";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import {
  CACHE_MINUTES,
  mcpTable,
  ourHooks,
  timesFor,
  withMcpTable,
  withOurHooks,
  type Hooks,
  type Invocation,
} from "../src/deliver/setup.ts";
import { StartsFile, startsPath, type Start, type Starts } from "./deliver.ts";
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

export const setup = Effect.fn(function* (command: SetupCommand) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repository = yield* repositoryOf(command.root);
  if (repository === undefined)
    return yield* Effect.fail(`${command.root} is not in a git repository.`);
  const times = timesFor(command.cacheMinutes ?? CACHE_MINUTES[command.harness]);
  const invocation = yield* invocationIn(repository);
  const feedback =
    command.feedback === undefined ? undefined : path.resolve(command.root, command.feedback);
  const options = { harness: command.harness, invocation, name: command.name, feedback, times };
  const said: string[] = [];

  // The MCP server needs one feedback file: the one named, the app's, or the default.
  const mcpFeedback =
    feedback ??
    (yield* feedbackOf(repository))[0] ??
    path.join(repository, ".blueline", "feedback.jsonl");
  const mcpArgs = [
    ...invocation.prefix,
    "mcp",
    mcpFeedback,
    "--wait",
    String(times.waitSeconds),
    ...(command.name === "agent" ? [] : ["--as", command.name]),
  ];

  if (command.harness === "claude") {
    const file = path.join(repository, ".claude", "settings.local.json");
    const settings = yield* readObject(file);
    const hooks = withOurHooks(hooksIn(settings), command.remove ? {} : ourHooks(options));
    const { hooks: _, ...rest } = settings;
    const next = Object.keys(hooks).length === 0 ? rest : { ...rest, hooks };
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* writeWhole(file, `${yield* Schema.encodeEffect(JsonObject)(next)}\n`);
    said.push(
      `${command.remove ? "Took Blueline's hooks out of" : "Wrote Blueline's hooks to"} ${file}.`,
    );
    // The MCP server in the user's local scope for this project, so no checked-in file holds
    // a path of this machine. Removed first, so a second run writes the same.
    yield* run("claude", ["mcp", "remove", "--scope", "local", "blueline"], repository);
    if (!command.remove) {
      const added = yield* run(
        "claude",
        ["mcp", "add", "--scope", "local", "blueline", "--", invocation.command, ...mcpArgs],
        repository,
      );
      said.push(
        added.code === 0
          ? "Added the blueline MCP server to Claude Code for this project."
          : `Could not add the MCP server: ${added.stderr.trim()}. Run: claude mcp add --scope local blueline -- ${[invocation.command, ...mcpArgs].join(" ")}`,
      );
    }
  } else {
    const hooksFile = path.join(repository, ".codex", "hooks.json");
    const settings = yield* readObject(hooksFile);
    const hooks = withOurHooks(hooksIn(settings), command.remove ? {} : ourHooks(options));
    yield* fs.makeDirectory(path.dirname(hooksFile), { recursive: true });
    yield* writeWhole(
      hooksFile,
      `${yield* Schema.encodeEffect(JsonObject)({ ...settings, hooks })}\n`,
    );
    const configFile = path.join(repository, ".codex", "config.toml");
    const toml = (yield* fs.exists(configFile)) ? yield* fs.readFileString(configFile) : "";
    const table = command.remove ? undefined : mcpTable(invocation.command, mcpArgs, times);
    yield* writeWhole(configFile, withMcpTable(toml, table));
    said.push(
      `${command.remove ? "Took Blueline out of" : "Wrote Blueline's hooks and MCP server to"} ${hooksFile} and ${configFile}.`,
      "Codex loads a project's .codex/ only once you trust the project: open it in Codex and accept.",
    );
  }

  // How the server starts a fresh agent for this repository.
  const { state } = yield* PLACE;
  const startsFile = startsPath(state);
  const starts = yield* readFile(startsFile, StartsFile, {});
  const was = starts[repository];
  const start: Start | undefined = command.remove ? undefined : (command.start ?? was?.start);
  const entry = {
    ...(start === undefined ? {} : { start }),
    ...(command.name === "agent" ? {} : { as: command.name }),
  };
  const nextStarts: Starts = Object.fromEntries(
    Object.entries({ ...starts, [repository]: entry }).filter(
      ([, e]) => e.start !== undefined || e.as !== undefined,
    ),
  );
  yield* fs.makeDirectory(state, { recursive: true });
  yield* writeWhole(startsFile, `${yield* Schema.encodeEffect(StartsFile)(nextStarts)}\n`);
  if (start !== undefined)
    said.push(`With no agent on the review, the server starts one by ${start.adapter}.`);
  said.push(
    `The prompt cache counts as warm for ${String(times.warmMinutes)} minutes; a wait lasts up to ${String(times.waitSeconds)} s.`,
  );
  yield* Console.log(said.join("\n"));
});
