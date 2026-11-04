import { describe, expect, it } from "vitest";
import { ours, ownRequest } from "../examples/review-demo/guard.ts";

/* The demo's routes answer the page itself and tools on the machine, never another site. */

const from = (headers: Record<string, string>) => ownRequest({ headers });

describe("ours", () => {
  it("takes each path that Connect sends to a route, in any case and after a dot", () => {
    expect(ours("/__agent")).toBe(true);
    expect(ours("/__AGENT")).toBe(true);
    expect(ours("/__agent.anything?x=1")).toBe(true);
    expect(ours("/__realtime/token")).toBe(true);
    expect(ours("/workshop.html")).toBe(false);
  });
});

describe("ownRequest", () => {
  it("takes the page's own requests, also behind a proxy that changes the host", () => {
    expect(from({ "sec-fetch-site": "same-origin", host: "127.0.0.1:4311" })).toBe(true);
    expect(from({ origin: "http://fry:4311", host: "fry:4311" })).toBe(true);
  });

  it("takes a tool's request, which has no origin", () => {
    expect(from({ host: "127.0.0.1:4311" })).toBe(true);
  });

  it("refuses another site, by its header or its origin", () => {
    expect(from({ "sec-fetch-site": "cross-site", host: "127.0.0.1:4311" })).toBe(false);
    expect(from({ "sec-fetch-site": "same-site", host: "fry:4311" })).toBe(false);
    expect(from({ origin: "https://attacker.invalid", host: "fry:4311" })).toBe(false);
  });
});
