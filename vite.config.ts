import { recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

/*
 * One config for the package's tools. `vp check` formats, lints and type checks; `vp test`
 * runs the tests; `vp pack` builds the package as it is published.
 */
export default defineConfig({
  lint: {
    extends: [recommended],
    options: { typeAware: true, typeCheck: true, denyWarnings: true },
    ignorePatterns: ["dist/**"],
    overrides: [
      {
        // Tool configuration, and the dev server's plugin, run before the application
        // runtime exists.
        files: ["*.config.ts", "src/vite.ts"],
        rules: { "effecttsgo/process-env": "off", "effecttsgo/node-builtin-import": "off" },
      },
    ],
  },
  fmt: {
    ignorePatterns: ["dist/**", "pnpm-lock.yaml"],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
  /*
   * The browser parts and the dev server's plugin with their types, and the agent's
   * command. The source is the package's `exports`; a published copy reads `dist`
   * (`publishConfig`). The three run at once, so none cleans `dist`: the `pack` script
   * empties it first.
   */
  pack: [
    {
      entry: {
        index: "src/index.ts",
        choices: "src/choices.ts",
        variants: "src/part/variants.tsx",
        workshop: "src/workshop/workshop.tsx",
      },
      platform: "browser",
      tsconfig: "tsconfig.app.json",
      dts: true,
      clean: false,
      copy: [{ from: "src/styles.css", to: "dist" }],
    },
    {
      entry: { vite: "src/vite.ts" },
      platform: "node",
      tsconfig: "tsconfig.node.json",
      dts: true,
      // The plugin's types name Vite's `Plugin`: the app that loads the plugin has Vite.
      deps: { neverBundle: ["vite"] },
      fixedExtension: false,
      clean: false,
    },
    {
      entry: { "bin/blueline": "bin/blueline.ts" },
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
