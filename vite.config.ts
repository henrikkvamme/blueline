import { defineConfig } from "vite-plus";

/*
 * `vp pack` builds the package as it is published: the browser parts and the dev server's
 * plugin with their types, and the agent's command. The workspace's apps import the source
 * (package.json `exports`); a published copy reads `dist` (`publishConfig`). The three run
 * at once, so none cleans `dist`: the package's `pack` script empties it first.
 */
export default defineConfig({
  pack: [
    {
      entry: {
        index: "src/index.ts",
        choices: "src/choices.ts",
        variants: "src/part/variants.tsx",
        workshop: "src/workshop/workshop.tsx",
      },
      platform: "browser",
      tsconfig: "tsconfig.json",
      dts: true,
      clean: false,
      copy: [{ from: "src/styles.css", to: "dist" }],
    },
    {
      entry: { vite: "src/vite.ts" },
      platform: "node",
      tsconfig: "tsconfig.node.json",
      dts: true,
      fixedExtension: false,
      clean: false,
    },
    {
      entry: { "bin/channel": "bin/channel.ts" },
      platform: "node",
      // The platform layer goes in the command: its own dependencies on npm resolve to a
      // release that does not fit the pinned effect.
      deps: { onlyBundle: ["@effect/platform-node", "@effect/platform-node-shared"] },
      tsconfig: "tsconfig.node.json",
      fixedExtension: false,
      clean: false,
    },
  ],
});
