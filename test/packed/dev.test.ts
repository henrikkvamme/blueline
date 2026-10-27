import { execFile, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { app, freePort, listening, until } from "../helpers/apps";
import { folder } from "../helpers/dev";

/*
 * `blueline dev` from the built package, with its built preload and guard: it runs a Vite
 * script behind its proxy, the page has the tag, a note lands, and Ctrl+C leaves no port.
 */

const DIST = path.join(import.meta.dirname, "..", "..", "dist");
const BIN = path.join(DIST, "bin", "blueline.js");
const run = promisify(execFile);

describe("the built blueline dev", () => {
  const state = folder("packed-dev-state");
  let port = 0;

  afterAll(async () => {
    await run(process.execPath, [BIN, "serve", "stop"], {
      cwd: state,
      env: { ...process.env, BLUELINE_PORT: String(port), BLUELINE_STATE: state },
    });
    rmSync(state, { recursive: true, force: true });
  });

  it("serves a Vite script's page with the tag", async () => {
    port = await freePort();
    const page = await freePort();
    const { root } = app("packed-vite", {
      "package.json": JSON.stringify({
        name: "packed-vite",
        type: "module",
        scripts: { dev: "vp dev" },
      }),
      "vite.config.js": `export default { server: { port: ${String(page)} } };\n`,
      "index.html": "<!doctype html><html><head></head><body>packed</body></html>",
    });
    const child = spawn(process.execPath, [BIN, "dev", "--", "pnpm", "dev"], {
      cwd: root,
      env: { ...process.env, BLUELINE_PORT: String(port), BLUELINE_STATE: state },
      stdio: "ignore",
    });
    const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
    try {
      const url = `http://localhost:${String(page)}`;
      let text = "";
      await until(
        async () => {
          text = await fetch(`${url}/`).then(
            (answer) => answer.text(),
            () => "",
          );
          return text.includes("packed");
        },
        30_000,
        "The page",
      );
      expect(text).toContain('<script type="module" src="/__devtools/tag.js"></script></head>');
      await until(
        async () =>
          (
            await fetch(`${url}/__devtools/feedback`, {
              method: "POST",
              body: '{"kind":"note"}',
              headers: { "content-type": "application/json", origin: url },
            })
          ).status === 204,
        10_000,
        "The note",
      );
      expect(readFileSync(path.join(root, ".blueline", "feedback.jsonl"), "utf8")).toContain(
        '"note"',
      );
      child.kill("SIGINT");
      expect(await exited).toBe(130);
      expect(await listening(page)).toBe(false);
    } finally {
      child.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
