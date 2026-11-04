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

/** Whether a tool's input stays in the folder: its path, and a glob that names no other. */
export function inputInside(root: string, input: Readonly<Record<string, unknown>>): boolean {
  const path = input["file_path"] ?? input["path"] ?? input["notebook_path"];
  const pattern = input["pattern"];
  if (typeof pattern === "string" && (isAbsolute(pattern) || pattern.split("/").includes("..")))
    return false;
  return typeof path !== "string" || inside(root, path);
}
