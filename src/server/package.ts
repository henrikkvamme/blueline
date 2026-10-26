import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Where this package is, from the running module's own file: the source in a checkout of
 * Blueline, or the build in an app's `node_modules`. The server serves the overlay from it,
 * and a dev server starts the server's command from it.
 */

const NAME = "@henrikkvamme/blueline";
const here = fileURLToPath(import.meta.url);

/** The folder of this package's `package.json`. */
export function packageRoot(): string {
  for (let at = path.dirname(here); at !== path.dirname(at); at = path.dirname(at)) {
    const file = path.join(at, "package.json");
    if (existsSync(file) && readFileSync(file, "utf8").includes(`"name": "${NAME}"`)) return at;
  }
  throw new Error(`No ${NAME} folder above ${here}.`);
}

/** The `blueline` command of this copy: the source runs the source, the build the build. */
export const commandFile = (): string =>
  here.endsWith(".ts")
    ? path.join(packageRoot(), "bin", "blueline.ts")
    : path.join(packageRoot(), "dist", "bin", "blueline.js");
