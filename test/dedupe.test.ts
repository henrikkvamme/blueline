import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Plugin } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { devtoolsChannel } from "../src/vite";

/*
 * An app that links Blueline from its source: the app has its React, and Blueline's folder
 * has its own. The plugin has Blueline's files take the app's.
 */

const base = mkdtempSync(path.join(tmpdir(), "blueline-dedupe-"));

/** A small package `name` in `folder`'s node_modules, with a JSX runtime. */
function install(folder: string, name: string) {
  const at = path.join(folder, "node_modules", name);
  mkdirSync(at, { recursive: true });
  writeFileSync(path.join(at, "package.json"), JSON.stringify({ name, main: "index.js" }));
  writeFileSync(path.join(at, "index.js"), "export default {};\n");
  writeFileSync(path.join(at, "jsx-runtime.js"), "export const jsx = () => null;\n");
}

/** A folder with a package.json, and React when `react`. */
function folder(name: string, react: boolean) {
  const at = path.join(base, name);
  mkdirSync(path.join(at, "src"), { recursive: true });
  writeFileSync(path.join(at, "package.json"), JSON.stringify({ name }));
  if (react) for (const pkg of ["react", "react-dom"]) install(at, pkg);
  return at;
}

const blueline = folder("blueline", true);
const part = path.join(blueline, "src", "part.js");
writeFileSync(part, 'import "react";\n');

/** Where `id`, imported by Blueline's part, resolves in an app at `root`. */
async function resolved(root: string, plugins: Plugin[], id: string) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins,
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const found = await server.environments.client.pluginContainer.resolveId(id, part);
    return found?.id;
  } finally {
    await server.close();
  }
}

const channel = (root: string) => [
  devtoolsChannel({
    feedback: path.join(root, ".blueline", "feedback.jsonl"),
    status: path.join(root, ".blueline", "status.json"),
  }),
];

describe("React for Blueline's source", () => {
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const app = folder("app", true);
  const inApp = path.join(app, "node_modules");
  const inBlueline = path.join(blueline, "node_modules");

  it("is the app's copy, with its subpaths", async () => {
    for (const id of ["react", "react/jsx-runtime", "react-dom"])
      expect(await resolved(app, channel(app), id)).toContain(inApp);
  });

  it("would be Blueline's own copy without the plugin", async () => {
    expect(await resolved(app, [], "react")).toContain(inBlueline);
  });

  it("is Blueline's own copy for an app with no React", async () => {
    const plain = folder("plain", false);
    expect(await resolved(plain, channel(plain), "react")).toContain(inBlueline);
  });
});
