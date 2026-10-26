import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "../src/server/channel";
import { devtoolsChannel, ROUTES } from "../src/vite";

/*
 * The channel over HTTP, as the page and the agent's tools reach it through the Vite
 * plugin's dev server.
 */

const folder = mkdtempSync(path.join(tmpdir(), "blueline-channel-"));
const feedback = path.join(folder, ".blueline", "feedback.jsonl");
const status = path.join(folder, ".blueline", "status.json");
let server: ViteDevServer | undefined;
let base = "";

beforeAll(async () => {
  server = await createServer({
    root: folder,
    configFile: false,
    logLevel: "silent",
    plugins: [devtoolsChannel({ feedback, status })],
    server: { port: 0, host: "127.0.0.1", ws: false },
    optimizeDeps: { noDiscovery: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== "object" || address === null) throw new Error("The server has no port.");
  base = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await server?.close();
  rmSync(folder, { recursive: true, force: true });
});

const lines = (): unknown[] => {
  try {
    return readFileSync(feedback, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as unknown);
  } catch {
    return [];
  }
};

const post = (route: string, body: BodyInit, type: string, origin?: string) =>
  fetch(`${base}${route}`, {
    method: "POST",
    body,
    headers: { "content-type": type, ...(origin === undefined ? {} : { origin }) },
  });

describe("the channel over HTTP", () => {
  it("appends a note from the page with its ID and version", async () => {
    const answer = await post(ROUTES.feedback, '{"kind":"note"}', "application/json", base);
    expect(answer.status).toBe(204);
    expect(lines()).toEqual([{ kind: "note", v: 1, line: expect.any(String) }]);
  });

  it("refuses a note that is not a JSON object, or not sent as JSON", async () => {
    const before = lines().length;
    expect((await post(ROUTES.feedback, "{nope", "application/json")).status).toBe(400);
    expect((await post(ROUTES.feedback, "[1]", "application/json")).status).toBe(400);
    expect((await post(ROUTES.feedback, "{}", "text/plain")).status).toBe(415);
    expect((await fetch(`${base}${ROUTES.feedback}`)).status).toBe(405);
    expect(lines()).toHaveLength(before);
  });

  it("writes nothing for another site's page", async () => {
    const before = lines().length;
    const answer = await post(ROUTES.feedback, "{}", "application/json", "https://example.com");
    expect(answer.status).toBe(403);
    const image = await post(ROUTES.images, "x", "image/png", "https://example.com");
    expect(image.status).toBe(403);
    expect(lines()).toHaveLength(before);
  });

  it("keeps a screenshot and shows it again", async () => {
    const kept = await post(ROUTES.images, new Uint8Array([1, 2, 3]), "image/png", base);
    const { name, file } = (await kept.json()) as { name: string; file: string };
    expect(file).toBe(path.join(folder, ".blueline", "images", name));
    const shown = await fetch(`${base}${ROUTES.images}/${name}`);
    expect(shown.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await shown.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await fetch(`${base}${ROUTES.images}/missing.png`)).status).toBe(404);
    expect((await fetch(`${base}${ROUTES.images}/..%2Fstatus.json`)).status).toBe(404);
  });

  it("refuses a screenshot of another type, or over the limit", async () => {
    expect((await post(ROUTES.images, "x", "image/svg+xml")).status).toBe(415);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    expect((await post(ROUTES.images, big, "image/png")).status).toBe(413);
  });

  it("reads the agent's answers and its listeners, or nothing yet", async () => {
    const empty = await fetch(`${base}${ROUTES.status}`);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toEqual({});
    writeFileSync(status, '{"n1":{"state":"working"}}');
    writeFileSync(`${feedback}.listening.json`, '{"agent":{}}');
    expect(await (await fetch(`${base}${ROUTES.status}`)).json()).toEqual({
      n1: { state: "working" },
    });
    expect(await (await fetch(`${base}${ROUTES.listening}`)).json()).toEqual({ agent: {} });
  });
});
