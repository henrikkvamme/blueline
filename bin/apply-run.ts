import { Effect, FileSystem, Path, PlatformError } from "effect";
import { applyVerdicts, dropPartFields, verdictsIn, type Applied } from "./apply.ts";
import type { Command } from "./lines.ts";
import { writeWhole } from "./wire.ts";

/*
 * `apply` takes the reviewer's verdicts on a part's variants from the feedback file and
 * applies them to the code under `--src` (bin/apply.ts): it returns each change, which the
 * command prints and `blueline mcp`'s `apply` tool returns, and fails with words for the
 * agent when it cannot tell which variant to keep.
 */

/** Folders with no code of ours. */
const SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git", ".turbo"]);

/** The TypeScript files under the folder, out of the folders with no code of ours. */
const codeIn = Effect.fn(function* (
  dir: string,
): Effect.fn.Return<
  readonly string[],
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: string[] = [];
  for (const name of yield* fs.readDirectory(dir)) {
    const at = path.join(dir, name);
    const info = yield* fs.stat(at);
    if (info.type === "Directory" && !SKIP.has(name)) files.push(...(yield* codeIn(at)));
    else if (info.type === "File" && /\.tsx?$/.test(name) && !name.endsWith(".d.ts"))
      files.push(at);
  }
  return files;
});

export const applyCommand = Effect.fn(function* (command: Extract<Command, { kind: "apply" }>) {
  const fs = yield* FileSystem.FileSystem;
  const lines = (yield* fs.readFileString(command.file)).split("\n");
  const verdicts = verdictsIn(lines, command.part);
  if (verdicts === undefined) return [`The reviewer has no verdicts on ${command.part} yet.`];
  const files = yield* codeIn(command.src);
  const sources = yield* Effect.forEach(files, (file) =>
    fs.readFileString(file).pipe(Effect.map((source) => ({ file, source }))),
  );
  const marked = (source: string) => source.includes(command.part);
  const applied: Array<Applied & { readonly file: string; readonly was: string }> = [];
  for (const { file, source } of sources.filter((s) => marked(s.source))) {
    const result = yield* Effect.try({
      try: () => applyVerdicts(file, source, command.part, verdicts, command.keep),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    });
    applied.push({ ...result, file, was: source });
  }
  const changed = applied.filter((a) => a.changes.length > 0);
  // The part is one variant now: in the code, or as the verdicts say.
  const resolved =
    command.keep !== undefined ||
    verdicts.kept.length === 1 ||
    changed.some((a) => a.changes.some((c) => c.endsWith(" alone")));
  if (resolved && changed.length > 0)
    for (const a of applied.filter((a) => a.changes.length === 0))
      changed.push({ ...dropPartFields(a.file, a.was, command.part), file: a.file, was: a.was });
  const said: string[] = [];
  for (const a of changed.filter((a) => a.changes.length > 0)) {
    yield* writeWhole(a.file, a.source);
    said.push(...a.changes);
  }
  if (changed.length === 0)
    said.push(`Nothing to change for ${command.part} under ${command.src}.`);
  return said;
});
