/*
 * A dev server on Node for test/dev.test.ts, which `blueline dev` runs and moves: it listens
 * on the port in its first argument after a wait in its second, in ms. Each path answers in
 * one way the proxy must handle: compressed HTML, a page that streams, a `</head>` cut in
 * two, JSON, a 304, the headers it got, a header that `connection` names, and a websocket
 * that echoes each text message.
 */
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import zlib from "node:zlib";

const [port = "0", delay = "0"] = process.argv.slice(2);
const PAGE = "<!doctype html><html><head><title>Fixture</title></head><body>page</body></html>";

/** The streamed page waits here until a test asks for `/release`. */
let release: () => void = () => undefined;
const released = () => new Promise<void>((done) => (release = done));

const page = (response: ServerResponse, body: Buffer, coding?: string) => {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(body.length),
    etag: '"page"',
    "last-modified": "Mon, 26 Oct 2026 10:00:00 GMT",
    ...(coding === undefined ? {} : { "content-encoding": coding }),
  });
  response.end(body);
};

const server = createServer((request, response) => {
  const url = request.url ?? "/";
  if (url === "/") return page(response, Buffer.from(PAGE));
  if (url === "/gzip") return page(response, zlib.gzipSync(PAGE), "gzip");
  if (url === "/br") return page(response, zlib.brotliCompressSync(PAGE), "br");
  if (url === "/deflate") return page(response, zlib.deflateSync(PAGE), "deflate");
  if (url === "/split") {
    response.writeHead(200, { "content-type": "text/html" });
    response.write("<html><head><title>x</title></he");
    return void setTimeout(() => response.end("ad><body>split</body></html>"), 50);
  }
  if (url === "/stream") {
    response.writeHead(200, { "content-type": "text/html" });
    response.write("<html><head></head><body>first");
    return void released().then(() => response.end("rest</body></html>"));
  }
  if (url === "/release") {
    release();
    return void response.end("released");
  }
  if (url === "/json") {
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "11",
      etag: '"json"',
    });
    return void response.end('{"a":"b"}\n\n');
  }
  if (url === "/not-modified") {
    response.writeHead(304, { etag: '"page"' });
    return void response.end();
  }
  if (url === "/headers") {
    response.writeHead(200, { "content-type": "application/json" });
    return void response.end(JSON.stringify(request.headers));
  }
  if (url === "/named") {
    response.writeHead(200, {
      "content-type": "text/plain",
      connection: "x-secret",
      "x-secret": "1",
    });
    return void response.end("named");
  }
  response.statusCode = 404;
  response.end();
});

/** A text frame from the server, which has no mask, for a message under 126 bytes. */
const frame = (text: Buffer) => Buffer.concat([Buffer.from([0x81, text.length]), text]);

server.on("upgrade", (request, socket: Duplex) => {
  const key = String(request.headers["sec-websocket-key"]);
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Fixture: yes\r\n\r\n`,
  );
  socket.on("data", (data: Buffer) => {
    // A client's short text frame: its opcode, its masked length, the mask, the bytes.
    if ((data[0] ?? 0) & 0x08) return void socket.end();
    const length = (data[1] ?? 0) & 0x7f;
    const mask = data.subarray(2, 6);
    const text = Buffer.from(
      data.subarray(6, 6 + length).map((byte, i) => byte ^ (mask[i % 4] ?? 0)),
    );
    socket.write(frame(Buffer.from(`echo ${text.toString()}`)));
  });
});

setTimeout(() => server.listen(Number(port), "127.0.0.1"), Number(delay));
