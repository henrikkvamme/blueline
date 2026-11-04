import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

/*
 * Whether a path that an agent's tool names stays in a folder, by its real path: a symbolic
 * link inside that points outside is outside. A file that does not exist yet is judged by the
 * nearest folder above it that does. `node_modules` and `.git` are outside too.
 */
export function inside(root: string, path: string): boolean {
  const real = (at: string): string => {
    if (existsSync(at)) return realpathSync(at);
    const up = dirname(at);
    return up === at ? at : resolve(real(up), basename(at));
  };
  const rel = relative(real(root), real(resolve(root, path)));
  return !rel.startsWith("..") && !isAbsolute(rel) && !/(^|\/)(node_modules|\.git)(\/|$)/.test(rel);
}

/** A glob that names a file outside: an absolute one, or one that goes up. */
const out = (glob: unknown) =>
  typeof glob === "string" && (isAbsolute(glob) || glob.split("/").includes(".."));

/**
 * Whether a tool's input stays in the folder: its path, and a glob that names no other. Glob's
 * pattern is a glob of files; Grep's is a regex of text, so only its glob filter is one.
 */
export function inputInside(
  root: string,
  tool: string,
  input: Readonly<Record<string, unknown>>,
): boolean {
  const path = input["file_path"] ?? input["path"] ?? input["notebook_path"];
  if (out(input["glob"]) || (tool === "Glob" && out(input["pattern"]))) return false;
  return typeof path !== "string" || inside(root, path);
}
