import { renameSync, writeFileSync } from "node:fs";
import net from "node:net";

/*
 * The preload that `blueline dev` puts first in the command's `NODE_OPTIONS`
 * (src/server/dev.ts). In each Node process of the command, a listen on the page's port
 * listens on a port that the system gives, on the host it asked for, and that server's
 * `address()` still gives the page's port, so the dev server names the page's port in its
 * lines, its HMR client and its request URLs. When it listens, the preload writes its real
 * address to the report file, through a new file and a rename. No other listen changes.
 * `--require` loads it before any other preload; it has no top-level await, so Node loads
 * this ES module that way, and it imports only Node's own modules.
 */

const page = Number(process.env["BLUELINE_DEV_PORT"]);
const report = process.env["BLUELINE_DEV_REPORT"];

/** The port that a listen's arguments ask for, if they ask for one. */
function askedPort(first: unknown): number | undefined {
  const port: unknown =
    typeof first === "object" && first !== null ? Reflect.get(first, "port") : first;
  if (typeof port === "number") return port;
  if (typeof port === "string" && /^\d+$/.test(port)) return Number(port);
  return undefined;
}

if (Number.isInteger(page) && page > 0 && report !== undefined) {
  const listen = Reflect.get(net.Server.prototype, "listen") as (...args: unknown[]) => net.Server;
  const moved = function (this: net.Server, ...args: unknown[]) {
    if (askedPort(args[0]) !== page) return Reflect.apply(listen, this, args) as net.Server;
    const [first] = args;
    args[0] = typeof first === "object" && first !== null ? { ...first, port: 0 } : 0;
    const real = this.address.bind(this);
    this.address = () => {
      const address = real();
      return typeof address === "object" && address !== null ? { ...address, port: page } : address;
    };
    this.once("listening", () => {
      const address = real();
      if (typeof address !== "object" || address === null) return;
      const next = `${report}.${String(process.pid)}`;
      writeFileSync(next, JSON.stringify({ pid: process.pid, ...address }));
      renameSync(next, report);
    });
    return Reflect.apply(listen, this, args) as net.Server;
  };
  net.Server.prototype.listen = moved as typeof net.Server.prototype.listen;
}
