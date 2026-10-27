/*
 * A dev server that listens on the page's port, closes, and listens there again, as a dev
 * server does when it starts again, for test/hook.test.ts: the preload must report its
 * real port each time.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const page = Number(process.env["BLUELINE_DEV_PORT"]);
const report = process.env["BLUELINE_DEV_REPORT"] ?? "";
const server = createServer();
const listened = () => new Promise<void>((done) => server.listen(page, "127.0.0.1", done));

await listened();
const first = JSON.parse(readFileSync(report, "utf8")) as { port: number };
await new Promise((done) => server.close(done));
await listened();
const second = JSON.parse(readFileSync(report, "utf8")) as { port: number };
const address = server.address();
console.log(
  JSON.stringify({
    first: first.port,
    second: second.port,
    address: typeof address === "object" && address !== null ? address.port : 0,
  }),
);
server.close();
