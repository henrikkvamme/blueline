import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/*
 * The built variants, loaded by plain Node as an app's unit tests load a dependency: no
 * bundler sets `import.meta.env`, so a part is its first variant, as in a production build.
 */

const VARIANTS = pathToFileURL(path.join(import.meta.dirname, "..", "..", "dist", "variants.js"));
const run = promisify(execFile);

describe("the built variants outside a bundler", () => {
  it("gives the first variant", async () => {
    const script = `
      const { variants } = await import(${JSON.stringify(VARIANTS.href)});
      const first = () => "first";
      const part = variants("Part", { First: first, Second: () => "second" });
      console.log(part === first ? "first" : "other");
    `;
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script]);
    expect(stdout.trim()).toBe("first");
  });
});
