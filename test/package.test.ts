import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };

/*
 * The workspace imports the source and a published copy reads `dist`, so each entry needs
 * both: an entry missing from `publishConfig` builds here and breaks only once published.
 */
describe("the package's manifest", () => {
  it("publishes every entry the workspace imports", () => {
    expect(Object.keys(manifest.publishConfig.exports)).toEqual(Object.keys(manifest.exports));
  });

  it("publishes the agent's command under the same name", () => {
    expect(Object.keys(manifest.publishConfig.bin)).toEqual(Object.keys(manifest.bin));
  });

  it("publishes only from dist", () => {
    const paths = [
      ...Object.values(manifest.publishConfig.exports).flatMap((e) =>
        typeof e === "string" ? [e] : Object.values(e),
      ),
      ...Object.values(manifest.publishConfig.bin),
    ];
    for (const p of paths) expect(p).toMatch(/^\.\/dist\//);
  });
});
