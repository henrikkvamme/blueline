import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES, TAG } from "../src/server/page";
import {
  app,
  blueline,
  freePort,
  left,
  listening,
  portsOf,
  tree,
  until,
  type Running,
} from "./helpers/apps";
import { folder, startServe } from "./helpers/dev";

/*
 * `blueline dev` with real dev servers: Vite as `vp dev` and Next.js as `next dev`, through
 * package scripts and with their ports in their configs. The page has the tag, the HMR
 * websocket goes through, a note lands, a browser mounts the overlay with the app's config,
 * and every process and port is gone after each way of stopping.
 */

const TAG_HTML = `<script type="module" src="${TAG}"></script>`;
const INDEX = "<!doctype html><html><head><title>Vite</title></head><body>vite</body></html>";
const CONFIG = `import { defineConfig } from "@henrikkvamme/blueline/config";
export default defineConfig({ journeys: [{ id: "from-config", title: "From config", steps: [] }] });
`;

let serve: Awaited<ReturnType<typeof startServe>>;
const running: Running[] = [];
const removes: (() => void)[] = [];

beforeAll(async () => {
  const built = folder("built");
  const overlay = path.join(built, "index.js");
  writeFileSync(
    overlay,
    "export const mountPage = (options) => { window.__mounted = options; };\n",
  );
  const config = path.join(built, "config.js");
  writeFileSync(config, "export const defineConfig = (config) => config;\n");
  serve = await startServe({ overlay, config });
});
afterAll(async () => {
  for (const each of running) each.child.kill("SIGKILL");
  await Promise.all(running.map((each) => each.exited));
  for (const remove of removes) remove();
  await serve.close();
});

function viteApp(port: number, files: Record<string, string> = {}) {
  const made = app("vite", {
    "package.json": JSON.stringify({
      name: "vite-app",
      private: true,
      type: "module",
      scripts: { dev: "vp dev" },
    }),
    "vite.config.js": `export default { server: { port: ${String(port)} } };\n`,
    "index.html": INDEX,
    "blueline.config.js": CONFIG,
    ...files,
  });
  removes.push(made.remove);
  return made.root;
}

function nextApp(script: string, files: Record<string, string> = {}) {
  const made = app("next", {
    "package.json": JSON.stringify({ name: "next-app", private: true, scripts: { dev: script } }),
    "app/layout.js":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
    "app/page.js": "export default function Page() { return <p>next page</p>; }\n",
    "proxy.js": `import { NextResponse } from "next/server";
export function proxy(request) {
  const response = NextResponse.next();
  response.headers.set("x-origin", request.nextUrl.origin);
  return response;
}
`,
    "blueline.config.js": CONFIG,
    ...files,
  });
  removes.push(made.remove);
  return made.root;
}

/** An app folder that the tests remove at the end. */
function plain(name: string, files: Record<string, string> = {}) {
  const made = app(name, files);
  removes.push(made.remove);
  return made.root;
}

function start(root: string, args: readonly string[], env: Record<string, string> = {}) {
  const each = blueline(root, args, serve, env);
  running.push(each);
  return each;
}

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
}

function get(url: string, headers: Record<string, string> = {}, method = "GET", body = "") {
  return new Promise<Answer>((done, fail) => {
    const sent = request(url, { method, headers }, (answer) => {
      let text = "";
      answer.on("data", (chunk: Buffer) => (text += chunk.toString()));
      answer.on("end", () =>
        done({ status: answer.statusCode ?? 0, headers: answer.headers, text }),
      );
    });
    sent.on("error", fail);
    sent.end(body);
  });
}

/** Waits until the page answers through the proxy with the dev server's own page. */
async function page(each: Running, port: number) {
  let answer: Answer | undefined;
  await until(
    async () => {
      if (each.child.exitCode !== null) throw new Error(`blueline dev ended:\n${each.output()}`);
      answer = await get(`http://localhost:${String(port)}/`, { accept: "text/html" }).catch(
        () => undefined,
      );
      return answer !== undefined && answer.status === 200;
    },
    60_000,
    "The page",
  );
  return answer as Answer;
}

/** A note sent through the page's route, once the registration answers. */
async function note(port: number, root: string, text: string) {
  const url = `http://localhost:${String(port)}`;
  await until(
    async () =>
      (
        await get(
          `${url}${ROUTES.feedback}`,
          { "content-type": "application/json", origin: url },
          "POST",
          JSON.stringify({ kind: "note", text }),
        )
      ).status === 204,
    10_000,
    "The note",
  );
  return readFileSync(path.join(root, ".blueline", "feedback.jsonl"), "utf8");
}

/** Vite's HMR websocket through the proxy: its token from the client, then `connected`. */
async function hmr(port: number) {
  const client = await get(`http://localhost:${String(port)}/@vite/client`);
  const token = /wsToken\s*=\s*"([^"]+)"/.exec(client.text)?.[1];
  expect(token).toBeDefined();
  const socket = new WebSocket(
    `ws://localhost:${String(port)}/?token=${String(token)}`,
    "vite-hmr",
  );
  const first = await new Promise<string>((done, fail) => {
    socket.addEventListener("message", (event) => done(String(event.data)));
    socket.addEventListener("error", () => fail(new Error("HMR failed")));
  });
  socket.close();
  return first;
}

/** Stops `blueline dev` with `signal`, and checks that each process and port it had is gone. */
async function stopsWith(each: Running, port: number, signal: NodeJS.Signals) {
  const pid = each.child.pid ?? 0;
  const { pids, groups } = await tree(pid);
  const ports = await portsOf([pid, ...pids]);
  expect(ports).toContain(port);
  expect(ports.length).toBeGreaterThan(1);
  each.child.kill(signal);
  const exited = await each.exited;
  if (signal !== "SIGKILL") expect(exited.code).toBe(130);
  await until(async () => (await left(pids, groups)).length === 0, 10_000, "The group's end");
  for (const each of ports) expect(await listening(each)).toBe(false);
}

describe("blueline dev with Vite", () => {
  it("serves the page with the tag on its config's port, with HMR and notes", async () => {
    const port = await freePort();
    const root = viteApp(port);
    const each = start(root, ["dev", "--", "pnpm", "dev"]);
    const answer = await page(each, port);
    expect(answer.text).toContain(`${TAG_HTML}</head>`);
    expect(answer.text).toContain("/@vite/client");
    expect(await hmr(port)).toContain('"connected"');
    expect(await note(port, root, "from vite")).toContain("from vite");
    await stopsWith(each, port, "SIGINT");
  }, 90_000);

  it("takes the port of another config file, and one from the script's own variable", async () => {
    const other = await freePort();
    const root = viteApp(1, {
      "package.json": JSON.stringify({
        name: "vite-app",
        private: true,
        type: "module",
        scripts: { dev: "vp dev -c other.config.js", env: "APP_PORT=0 vp dev -c env.config.js" },
      }),
      "other.config.js": `export default { server: { port: ${String(other)} } };\n`,
      "env.config.js": "export default { server: { port: Number(process.env.APP_PORT) } };\n",
    });
    const each = start(root, ["dev", "--", "pnpm", "dev"]);
    expect((await page(each, other)).text).toContain(TAG_HTML);
    await stopsWith(each, other, "SIGTERM");

    const fromEnv = await freePort();
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    pkg.scripts["env"] = `APP_PORT=${String(fromEnv)} vp dev -c env.config.js`;
    writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    const second = start(root, ["dev", "--", "pnpm", "run", "env"]);
    expect((await page(second, fromEnv)).text).toContain(TAG_HTML);
    await stopsWith(second, fromEnv, "SIGKILL");
  }, 120_000);

  it("lets a name in Vite's allowedHosts reach the page, Blueline and HMR, and no other", async () => {
    const port = await freePort();
    const root = viteApp(port, {
      "vite.config.js": `export default { server: { port: ${String(port)}, allowedHosts: ["app.test"] } };\n`,
    });
    const each = start(root, ["dev", "--", "pnpm", "dev"]);
    await page(each, port);
    const url = `http://127.0.0.1:${String(port)}`;
    const host = { host: `app.test:${String(port)}` };
    expect((await get(`${url}/`, host)).status).toBe(200);
    expect((await get(`${url}${TAG}`, host)).status).toBe(200);
    const other = { host: `evil.test:${String(port)}` };
    expect((await get(`${url}/`, other)).status).toBe(403);
    expect((await get(`${url}${TAG}`, other)).status).toBe(403);
    const client = await get(`${url}/@vite/client`, host);
    const token = /wsToken\s*=\s*"([^"]+)"/.exec(client.text)?.[1] ?? "";
    const status = await new Promise<number>((done, fail) => {
      const sent = request(`${url}/?token=${token}`, {
        headers: {
          ...host,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-protocol": "vite-hmr",
        },
      });
      sent.on("upgrade", (answer, socket) => {
        socket.destroy();
        done(answer.statusCode ?? 0);
      });
      sent.on("response", (answer) => done(answer.statusCode ?? 0));
      sent.on("error", fail);
      sent.end();
    });
    expect(status).toBe(101);
    await stopsWith(each, port, "SIGINT");
  }, 90_000);
});

describe("blueline dev with Next.js", () => {
  it("serves the streamed page with the tag, and Next.js sees the page's origin", async () => {
    const port = await freePort();
    const root = nextApp(`next dev -p ${String(port)}`);
    const each = start(root, ["dev", "--", "pnpm", "dev"], { PORT: String(await freePort()) });
    const answer = await page(each, port);
    expect(answer.text).toContain(TAG_HTML);
    expect(answer.text).toContain("next page");
    expect(answer.headers["x-origin"]).toBe(`http://localhost:${String(port)}`);
    expect(await note(port, root, "from next")).toContain("from next");
    await stopsWith(each, port, "SIGINT");
  }, 120_000);

  it.each(["SIGTERM", "SIGKILL"] as const)(
    "stops every process after %s",
    async (signal) => {
      const port = await freePort();
      const root = nextApp(`next dev --port ${String(port)}`);
      const each = start(root, ["dev", "--", "pnpm", "dev"]);
      await page(each, port);
      await stopsWith(each, port, signal);
    },
    120_000,
  );
});

describe("in a browser", () => {
  it.each(["vite", "next"] as const)(
    "mounts the overlay with the %s app's config",
    async (kind) => {
      const port = await freePort();
      const root = kind === "vite" ? viteApp(port) : nextApp(`next dev -p ${String(port)}`);
      const each = start(root, ["dev", "--", "pnpm", "dev"]);
      await page(each, port);
      const browser = await chromium.launch();
      try {
        const tab = await browser.newPage();
        await tab.goto(`http://localhost:${String(port)}/`);
        const mounted = await tab.waitForFunction(
          () =>
            (
              window as unknown as {
                __mounted?: { config?: { journeys: { id: string }[] }; storageKey: string };
              }
            ).__mounted,
          undefined,
          { timeout: 30_000 },
        );
        const options = (await mounted.jsonValue()) as {
          config?: { journeys: { id: string }[] };
          storageKey: string;
        };
        expect(options.storageKey).toBe("blueline");
        expect(options.config?.journeys[0]?.id).toBe("from-config");
      } finally {
        await browser.close();
      }
      await stopsWith(each, port, "SIGINT");
    },
    120_000,
  );
});

describe("starting and stopping", () => {
  it("ends with the command's code when it fails, and frees the page's port", async () => {
    const port = await freePort();
    const root = plain("fails");
    const each = start(root, [
      "dev",
      "--port",
      String(port),
      "--",
      process.execPath,
      "-e",
      "process.exit(3)",
    ]);
    expect((await each.exited).code).toBe(3);
    expect(await listening(port)).toBe(false);
  }, 30_000);

  it("stops when Vite's config throws, before the command starts", async () => {
    const root = viteApp(1, { "vite.config.js": 'throw new Error("broken config");\n' });
    const each = start(root, ["dev", "--", "pnpm", "dev"]);
    expect((await each.exited).code).toBe(1);
    expect(each.output()).toContain("broken config");
  }, 30_000);

  it("starts nothing when the page's port is taken", async () => {
    const port = await freePort();
    const holder = createNetServer();
    await new Promise<void>((done) => holder.listen(port, "127.0.0.1", done));
    try {
      const root = plain("taken");
      const marker = path.join(root, "started");
      const each = start(root, [
        "dev",
        "--port",
        String(port),
        "--",
        process.execPath,
        "-e",
        `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`,
      ]);
      expect((await each.exited).code).toBe(1);
      expect(each.output()).toContain(`Port ${String(port)} is taken`);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await new Promise((done) => holder.close(done));
    }
  }, 30_000);

  it("refuses a script that sets NODE_OPTIONS itself, before it starts", async () => {
    const root = nextApp("NODE_OPTIONS=--max-old-space-size=4096 next dev -p 3999");
    const each = start(root, ["dev", "--", "pnpm", "dev"]);
    expect((await each.exited).code).toBe(1);
    expect(each.output()).toContain("NODE_OPTIONS");
  }, 30_000);

  it("keeps the app's own preloads, and still moves the page's port", async () => {
    const port = await freePort();
    const root = plain("preloads", {
      "pre.cjs":
        'require("fs").writeFileSync(require("path").join(process.cwd(), "required"), "");\n',
      "pre.mjs": 'import { writeFileSync } from "node:fs";\nwriteFileSync("imported", "");\n',
    });
    const fixture = path.join(import.meta.dirname, "fixtures", "dev-server.ts");
    const each = start(
      root,
      ["dev", "--port", String(port), "--", process.execPath, fixture, String(port)],
      {
        NODE_OPTIONS: "--require ./pre.cjs --import ./pre.mjs",
      },
    );
    await page(each, port);
    expect(existsSync(path.join(root, "required"))).toBe(true);
    expect(existsSync(path.join(root, "imported"))).toBe(true);
    await stopsWith(each, port, "SIGINT");
  }, 30_000);
});

describe("the guard", () => {
  const GUARD = path.join(import.meta.dirname, "..", "src", "server", "guard.ts");

  /** The guard, with a command that waits, and what the guard says. */
  function guard() {
    const root = plain("guard");
    const child = spawn(
      process.execPath,
      [
        GUARD,
        JSON.stringify({
          command: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
          cwd: root,
          env: {},
        }),
      ],
      { stdio: ["pipe", "ignore", "ignore", "pipe"] },
    );
    let said = "";
    child.stdio[3]?.on("data", (chunk: Buffer) => (said += chunk.toString()));
    const ended = new Promise<string[]>((done) =>
      child.once("close", () => done(said.split("\n").filter(Boolean))),
    );
    return { child, ended };
  }

  it("starts nothing when its pipe closes before go", async () => {
    const { child, ended } = guard();
    child.stdin?.end();
    expect(await ended).toEqual(['{"stopped":true}']);
  });

  it("stops the group when its pipe closes right after go", async () => {
    const { child, ended } = guard();
    child.stdin?.end("go\n");
    const said = (await ended).map(
      (line) => JSON.parse(line) as { started?: number; stopped?: boolean },
    );
    const pid = said.find((event) => event.started !== undefined)?.started;
    expect(pid).toBeDefined();
    expect(said.at(-1)?.stopped).toBe(true);
    expect(await left([pid ?? 0], [pid ?? 0])).toEqual([]);
  });
});
