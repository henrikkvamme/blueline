import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "../src/server/channel";
import { ROUTES } from "../src/vite";
import { folder as newFolder, registered, startServe, startVite } from "./helpers/dev";

/*
 * The channel over HTTP, as the page and the agent's tools reach it: through the Vite
 * plugin's dev server to `blueline serve`, which writes the app's files.
 */

const folder = newFolder("channel");
const feedback = path.join(folder, ".blueline", "feedback.jsonl");
const status = path.join(folder, ".blueline", "status.json");
let server: ViteDevServer | undefined;
let closeServe: (() => Promise<void>) | undefined;
let base = "";

beforeAll(async () => {
  const served = await startServe();
  closeServe = served.close;
  const vite = await startVite(folder, served, { feedback, status });
  server = vite.server;
  base = vite.url;
  await registered(base);
});

afterAll(async () => {
  await server?.close();
  await closeServe?.();
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

describe("the channel through the plugin and the server", () => {
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
