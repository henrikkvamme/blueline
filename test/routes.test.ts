import { describe, expect, it } from "vitest";
import { ROUTES } from "../src/io/routes";
import { ROUTES as SERVED } from "../src/vite";

describe("the channel's routes", () => {
  it("are the same on the page and on the dev server", () => {
    expect(SERVED).toEqual(ROUTES);
  });
});
