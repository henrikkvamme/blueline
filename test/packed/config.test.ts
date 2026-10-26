import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "../../src/server/serve";
import { folder } from "../helpers/dev";

/*
 * An app's config end to end, in Chromium: a real dev server with the built plugin, or a page
 * with a tag by hand, on `blueline serve` with the built overlay and config module. The page
 * loads the config, walks its steps, goes on after a new page load in a step, and loads again
 * on the same step when the config changes.
 */

const REPO = path.join(import.meta.dirname, "..", "..");
const DIST = path.join(REPO, "dist");

let browser: Browser;
let served: { url: string; port: number; state: string; close: () => Promise<void> };

beforeAll(async () => {
  browser = await chromium.launch();
  const state = folder("e2e-state");
  const started = await serve({
    port: 0,
    state,
    overlay: path.join(DIST, "index.js"),
    config: path.join(DIST, "config.js"),
  });
  if (started.kind !== "started") throw new Error("Another server answered.");
  served = {
    url: `http://127.0.0.1:${String(started.port)}`,
    port: started.port,
    state,
    close: started.close,
  };
});
afterAll(async () => {
  await browser.close();
  await served.close();
  rmSync(served.state, { recursive: true, force: true });
});

/** An app's root, with Blueline installed as the app would have it. */
function app(files: Readonly<Record<string, string>>) {
  const root = folder("e2e-app");
  mkdirSync(path.join(root, "node_modules", "@henrikkvamme"), { recursive: true });
  symlinkSync(REPO, path.join(root, "node_modules", "@henrikkvamme", "blueline"));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return root;
}

const html = (body = "") => `<!doctype html><html><head></head><body>${body}</body></html>`;

/** The config with the steps, in their order, each with its title. */
const config = (steps: string, from = "@henrikkvamme/blueline/config") =>
  `import { defineConfig } from "${from}";\nexport default defineConfig({ journeys: [{ id: "j", title: "Journey", steps: [${steps}] }] });\n`;
const plain = (id: string, title: string) =>
  `{ id: "${id}", title: "${title}", look: "The part", group: "Group" }`;

/** The step the walk is on: its number and title, as the bar shows them. */
const onStep = (page: Page) =>
  page.evaluate(() => {
    const bar = document
      .querySelector("blueline-tools")
      ?.shadowRoot?.querySelector('[role="toolbar"][aria-label="Review"]');
    const title = bar?.querySelector('[aria-hidden="false"]')?.textContent ?? "";
    const at = bar?.querySelector(".tabular-nums")?.textContent ?? "";
    return `${at} ${title}`;
  });

/** Marks the page, so a test sees when it loads again. */
const mark = (page: Page) => page.evaluate(() => Reflect.set(window, "marked", true));
const marked = (page: Page) => page.evaluate(() => Reflect.get(window, "marked") === true);

describe("a config through the Vite plugin", { timeout: 30_000 }, () => {
  let server: ViteDevServer | undefined;
  afterAll(() => server?.close());

  async function vite(root: string) {
    const plugin: typeof import("../../src/vite") = await import(path.join(DIST, "vite.js"));
    server = await createServer({
      root,
      base: "/app/",
      configFile: false,
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true },
      plugins: [plugin.devtoolsChannel({ serve: { port: served.port, state: served.state } })],
      server: { port: 0, host: "127.0.0.1" },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (typeof address !== "object" || address === null) throw new Error("No port");
    return `http://localhost:${String(address.port)}`;
  }

  it("mounts the config from base /app/, and loads again on the same step when it changes", async () => {
    const root = app({
      "index.html": html(),
      "titles.ts": 'export const second: string = "Step b";\n',
      "blueline.config.ts": config(
        `${plain("a", "Step a")}, { ...${plain("b", "")}, title: second }, ${plain("c", "Step c")}`,
      ).replace("\n", '\nimport { second } from "./titles.ts";\n'),
    });
    const url = await vite(root);
    const page = await browser.newPage();
    await page.goto(`${url}/app/`);
    await page.waitForFunction(() => window.blueline?.start("j", "b") === true, undefined, {
      timeout: 15_000,
    });
    await expect.poll(() => onStep(page)).toBe("2 Step b");
    await mark(page);
    writeFileSync(
      path.join(root, "blueline.config.ts"),
      config(`${plain("c", "Step c")}, ${plain("a", "Step a")}, ${plain("b", "Step B")}`),
    );
    await expect.poll(() => marked(page), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => onStep(page), { timeout: 10_000 }).toBe("3 Step B");
    await page.close();
  });

  it("goes on in a step after open, and after a link that loads a new page", async () => {
    const root = app({
      "index.html": html(),
      "second.html": html('<a id="next" href="/app/third.html">Next</a>'),
      "third.html": html(
        '<button id="done" onclick="document.title = \'done\'">Done</button><p id="ready"></p>',
      ),
      "blueline.config.ts": config(
        `{ ...${plain("a", "Step a")}, enter: [{ open: "/app/second.html" }, { wait: "#next" }], setup: [{ click: "#next" }, { click: "#done" }], ready: ["#ready"] }`,
      ),
    });
    const url = await vite(root);
    const page = await browser.newPage();
    await page.goto(`${url}/app/`);
    await page.waitForFunction(() => window.blueline?.start("j") === true, undefined, {
      timeout: 15_000,
    });
    await page.waitForURL(`${url}/app/third.html`, { timeout: 10_000 });
    await expect.poll(() => page.title(), { timeout: 10_000 }).toBe("done");
    await expect.poll(() => onStep(page)).toBe("1 Step a");
    // The step went on: it did not open second.html again.
    await page.waitForTimeout(300);
    expect(page.url()).toBe(`${url}/app/third.html`);
    await page.close();
  });
});

describe("a config by a tag by hand", { timeout: 30_000 }, () => {
  let site: Server | undefined;
  afterAll(() => site?.close());

  it("runs the served config, and loads again when the file changes", async () => {
    const root = app({
      "blueline.config.ts": config(`${plain("a", "Step a")}, ${plain("b", "Step b")}`),
    });
    site = createHttpServer();
    await new Promise<void>((done) => site?.listen(0, "127.0.0.1", done));
    const address = site.address();
    if (typeof address !== "object" || address === null) throw new Error("No port");
    const origin = `http://localhost:${String(address.port)}`;
    const kept = (await (
      await fetch(`${served.url}/blueline/register`, {
        method: "POST",
        body: JSON.stringify({ root, origin, keep: true }),
      })
    ).json()) as { base: string };
    const tag = `<script type="module" src="${served.url}${kept.base}tag.js"></script>`;
    site.on("request", (_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(html(tag));
    });
    const page = await browser.newPage();
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => window.blueline?.start("j", "b") === true, undefined, {
      timeout: 15_000,
    });
    await expect.poll(() => onStep(page)).toBe("2 Step b");
    await mark(page);
    writeFileSync(
      path.join(root, "blueline.config.ts"),
      config(`${plain("b", "Step B")}, ${plain("a", "Step a")}`),
    );
    await expect.poll(() => marked(page), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => onStep(page), { timeout: 10_000 }).toBe("1 Step B");
    await page.close();
  });
});
