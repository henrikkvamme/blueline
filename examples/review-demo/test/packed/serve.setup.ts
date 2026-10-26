import { mkdirSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { serve, type Registered } from "../../../../src/server/serve.ts";

/*
 * `blueline serve` for the browser tests of the built package: it serves the built overlay.
 * The page has its origin kept for an app through the `keep` command, as `blueline add` does
 * for a tag by hand.
 */

const REPO = path.join(import.meta.dirname, "..", "..", "..", "..");
declare module "vitest" {
  export interface ProvidedContext {
    blueline: { readonly url: string; readonly root: string };
  }
}

declare module "vitest/browser" {
  interface BrowserCommands {
    /** Keeps the page's origin for the app at `root`, as `blueline add` does. */
    keep: (url: string, root: string, origin: string) => Promise<Registered>;
  }
}

/** Keeps a page's origin, from Node, where a page cannot do it itself. */
export async function keep(url: string, root: string, origin: string): Promise<Registered> {
  const answer = await fetch(`${url}/blueline/register`, {
    method: "POST",
    body: JSON.stringify({ root, origin, keep: true }),
  });
  return (await answer.json()) as Registered;
}

export default async function setup(project: TestProject) {
  const state = mkdtempSync(path.join(tmpdir(), "blueline-tag-"));
  // Inside the project, where the browser's `readFile` may read the app's notes.
  const root = path.join(REPO, ".blueline", "tag-test");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const served = await serve({ port: 0, state, overlay: path.join(REPO, "dist", "index.js") });
  if (served.kind !== "started") throw new Error("Another server answered.");
  const url = `http://127.0.0.1:${String(served.port)}`;
  project.provide("blueline", { url, root });
  return async () => {
    await served.close();
    rmSync(state, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  };
}
