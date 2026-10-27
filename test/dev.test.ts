import { readFileSync, writeFileSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDev, type Dev } from "../src/server/dev";
import { ROUTES, TAG } from "../src/server/page";
import { folder, startServe } from "./helpers/dev";

/*
 * `blueline dev`'s proxy (src/server/dev.ts) in front of a plain dev server on Node
 * (test/fixtures/dev-server.ts), which the preload moves off the page's port: the tag in
 * each HTML page, compressed or streamed, every other answer as it was, the headers of one
 * hop, a websocket, and Blueline's routes with the plugin's checks.
 */

const FIXTURE = path.join(import.meta.dirname, "fixtures", "dev-server.ts");
const TAG_HTML = `<script type="module" src="${TAG}"></script>`;

export async function freePort() {
  const server = createNetServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise((done) => server.close(done));
  if (typeof address !== "object" || address === null) throw new Error("No port");
  return address.port;
}

interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

/** A request with the headers a fetch does not let a test set, as `Host` and `Connection`. */
function raw(
  url: string,
  headers: Record<string, string> = {},
  method = "GET",
  body = "",
): Promise<Answer> {
  return new Promise((done, fail) => {
    const sent = request(url, { method, headers }, (answer) => {
      const chunks: Buffer[] = [];
      answer.on("data", (chunk: Buffer) => chunks.push(chunk));
      answer.on("end", () =>
        done({
          status: answer.statusCode ?? 0,
          headers: answer.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    sent.on("error", fail);
    sent.end(body);
  });
}

let serve: Awaited<ReturnType<typeof startServe>>;
let root: string;
let dev: Dev;
const said: string[] = [];

async function devOn(delay = 0) {
  const port = await freePort();
  return startDev({
    root,
    command: [process.execPath, FIXTURE, String(port), String(delay)],
    port,
    place: serve,
    say: (line) => said.push(line),
  });
}

beforeAll(async () => {
  const overlay = path.join(folder("overlay"), "index.js");
  writeFileSync(overlay, "export const mountPage = () => undefined;\n");
  serve = await startServe({ overlay });
  root = folder("dev-app");
  dev = await devOn();
});
afterAll(async () => {
  await dev.stop();
  await serve.close();
});

describe("the tag in HTML", () => {
  it("goes in a page, which loses the headers of the dev server's bytes", async () => {
    const answer = await raw(`${dev.url}/`, { accept: "text/html" });
    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toContain(`${TAG_HTML}</head>`);
    for (const name of ["content-length", "etag", "last-modified", "content-encoding"])
      expect(answer.headers[name]).toBeUndefined();
  });

  it("goes in compressed HTML, which goes out decoded", async () => {
    for (const coding of ["gzip", "br", "deflate"]) {
      const answer = await raw(`${dev.url}/${coding}`, { "accept-encoding": "gzip, br, deflate" });
      expect(answer.headers["content-encoding"]).toBeUndefined();
      expect(answer.body.toString()).toContain(`<title>Fixture</title>${TAG_HTML}</head>`);
    }
  });

  it("asks the dev server only for codings it can take off", async () => {
    const answer = await raw(`${dev.url}/headers`, {
      "accept-encoding": "gzip, compress, br;q=0.5",
    });
    expect(JSON.parse(answer.body.toString())["accept-encoding"]).toBe("gzip, br;q=0.5");
  });

  it("finds a </head> cut across two chunks", async () => {
    const answer = await raw(`${dev.url}/split`);
    expect(answer.body.toString()).toBe(
      `<html><head><title>x</title>${TAG_HTML}</head><body>split</body></html>`,
    );
  });

  it("sends a streamed page's first part with the tag before the rest exists", async () => {
    const first = await new Promise<string>((done, fail) => {
      const sent = request(`${dev.url}/stream`, (answer) => {
        answer.once("data", (chunk: Buffer) => {
          done(chunk.toString());
          answer.resume();
        });
      });
      sent.on("error", fail);
      sent.end();
    });
    expect(first).toContain(`${TAG_HTML}</head><body>first`);
    await raw(`${dev.url}/release`);
  });

  it("leaves JSON and a 304 as they were", async () => {
    const json = await raw(`${dev.url}/json`);
    expect(json.body.toString()).toBe('{"a":"b"}\n\n');
    expect(json.headers["content-length"]).toBe("11");
    expect(json.headers.etag).toBe('"json"');
    const unchanged = await raw(`${dev.url}/not-modified`);
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.etag).toBe('"page"');
  });

  it("asks for a page with no validators, so no page without the tag comes from a cache", async () => {
    const page = await raw(`${dev.url}/headers`, {
      accept: "text/html",
      "if-none-match": '"page"',
      "if-modified-since": "Mon, 26 Oct 2026 10:00:00 GMT",
    });
    const got = JSON.parse(page.body.toString()) as IncomingHttpHeaders;
    expect(got["if-none-match"]).toBeUndefined();
    expect(got["if-modified-since"]).toBeUndefined();
    const other = await raw(`${dev.url}/headers`, { "if-none-match": '"json"' });
    expect((JSON.parse(other.body.toString()) as IncomingHttpHeaders)["if-none-match"]).toBe(
      '"json"',
    );
  });
});

describe("the proxy", () => {
  it("keeps the page's Host, and drops the headers of one hop both ways", async () => {
    const answer = await raw(`${dev.url}/headers`, {
      connection: "keep-alive, x-hop",
      "x-hop": "1",
      "x-kept": "1",
    });
    const got = JSON.parse(answer.body.toString()) as IncomingHttpHeaders;
    expect(got.host).toBe(`localhost:${String(dev.port)}`);
    expect(got["x-hop"]).toBeUndefined();
    expect(got["x-kept"]).toBe("1");
    const named = await raw(`${dev.url}/named`);
    expect(named.body.toString()).toBe("named");
    expect(named.headers["x-secret"]).toBeUndefined();
  });

  it("passes a websocket's whole handshake and its messages both ways", async () => {
    const socket = new WebSocket(`ws://localhost:${String(dev.port)}/socket`);
    const echoed = new Promise<string>((done, fail) => {
      socket.addEventListener("message", (event) => done(String(event.data)));
      socket.addEventListener("error", () => fail(new Error("The websocket failed.")));
    });
    await new Promise<void>((done) => socket.addEventListener("open", () => done()));
    socket.send("hello");
    expect(await echoed).toBe("echo hello");
    socket.close();
  });

  it("gives back a websocket that the dev server refuses, as a whole answer", async () => {
    const answer = await new Promise<Answer>((done, fail) => {
      const sent = request(`${dev.url}/reject`, {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      });
      sent.on("response", (reply) => {
        const chunks: Buffer[] = [];
        reply.on("data", (chunk: Buffer) => chunks.push(chunk));
        reply.on("end", () =>
          done({
            status: reply.statusCode ?? 0,
            headers: reply.headers,
            body: Buffer.concat(chunks),
          }),
        );
        reply.on("error", fail);
      });
      sent.on("upgrade", () => fail(new Error("Upgraded")));
      sent.on("error", fail);
      sent.end();
    });
    expect(answer.status).toBe(403);
    expect(answer.body.toString()).toBe("nope");
  });

  it("holds a request until the dev server listens", async () => {
    const late = await devOn(400);
    try {
      const answer = await raw(`${late.url}/json`);
      expect(answer.body.toString()).toBe('{"a":"b"}\n\n');
    } finally {
      await late.stop();
    }
  });
});

describe("Blueline's routes", () => {
  const notes = () => {
    try {
      return readFileSync(path.join(root, ".blueline", "feedback.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  it("takes a note through the page's route into the root's file", async () => {
    let answer: Answer | undefined;
    for (const until = Date.now() + 5000; Date.now() < until;) {
      answer = await raw(
        `${dev.url}${ROUTES.feedback}`,
        {
          "content-type": "application/json",
          origin: dev.url,
        },
        "POST",
        '{"kind":"note","text":"through dev"}',
      );
      if (answer.status !== 503) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    expect(answer?.status).toBe(204);
    expect(notes().some((line) => line.includes("through dev"))).toBe(true);
  });

  it("refuses another Host and another site's page, and writes nothing", async () => {
    const before = notes().length;
    const host = await raw(
      `${dev.url}${ROUTES.feedback}`,
      { host: `evil.test:${String(dev.port)}` },
      "POST",
      "{}",
    );
    expect(host.status).toBe(403);
    const origin = await raw(
      `${dev.url}${ROUTES.feedback}`,
      { origin: "http://evil.test", "content-type": "application/json" },
      "POST",
      '{"kind":"note"}',
    );
    expect(origin.status).toBe(403);
    expect(notes()).toHaveLength(before);
  });

  it("gives the tag on the page's routes, and the overlay from the server", async () => {
    const tag = await raw(`${dev.url}${TAG}`);
    expect(tag.body.toString()).toContain('"/__devtools/overlay.js"');
    expect(tag.body.toString()).toContain(ROUTES.feedback);
    const overlay = await raw(`${dev.url}/__devtools/overlay.js`);
    expect(overlay.status).toBe(200);
    expect(overlay.body.toString()).toContain("mountPage");
  });

  it("serves the app's config on the page's origin, with its import there too", async () => {
    writeFileSync(
      path.join(root, "blueline.config.js"),
      'import { defineConfig } from "@henrikkvamme/blueline/config";\nexport default defineConfig({ journeys: [] });\n',
    );
    const tag = await raw(`${dev.url}${TAG}`);
    expect(tag.body.toString()).toContain('"/__devtools/config.js"');
    expect(tag.body.toString()).toContain('"/__devtools/events"');
    const config = await raw(`${dev.url}/__devtools/config.js`);
    expect(config.body.toString()).toContain('from "/__devtools/config-module.js"');
  });
});
