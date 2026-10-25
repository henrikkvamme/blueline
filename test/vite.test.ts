import { describe, expect, it } from "vitest";
import { fromPage, isJson } from "../src/vite";

describe("a write to the channel", () => {
  it("comes from the dev server's own page", () => {
    expect(fromPage({ origin: "http://localhost:4380", host: "localhost:4380" })).toBe(true);
  });

  it("does not come from another site", () => {
    expect(fromPage({ origin: "https://example.com", host: "localhost:4380" })).toBe(false);
    expect(fromPage({ origin: "http://localhost:5173", host: "localhost:4380" })).toBe(false);
    expect(fromPage({ origin: "null", host: "localhost:4380" })).toBe(false);
  });

  it("may come from a tool that is not a browser page", () => {
    expect(fromPage({ host: "localhost:4380" })).toBe(true);
  });

  it("is a note only as JSON", () => {
    expect(isJson("application/json")).toBe(true);
    expect(isJson("application/json; charset=utf-8")).toBe(true);
    expect(isJson("text/plain")).toBe(false);
    expect(isJson(undefined)).toBe(false);
  });
});
