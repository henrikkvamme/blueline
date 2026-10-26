import { recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

/** What the overlay's own bundle holds: React, Effect, XState, lucide and what they need. */
const PRIVATE =
  /^(react|react-dom|scheduler|use-sync-external-store|use-isomorphic-layout-effect|effect|xstate|@xstate\/react|lucide-react)(\/|$)/u;

/*
 * One config for the package's tools. `vp check` formats, lints and type checks; `vp test`
 * runs the tests; `vp pack` builds the package as it is published.
 */
export default defineConfig({
  lint: {
    extends: [recommended],
    options: { typeAware: true, typeCheck: true, denyWarnings: true },
    ignorePatterns: ["dist/**", "src/**/*.gen.ts"],
    overrides: [
      {
        // Tool configuration, the dev server's plugin and the build's scripts run before the
        // application runtime exists.
        files: ["*.config.ts", "src/vite.ts", "scripts/*.ts"],
        rules: { "effecttsgo/process-env": "off", "effecttsgo/node-builtin-import": "off" },
      },
    ],
  },
  fmt: {
    ignorePatterns: ["dist/**", "pnpm-lock.yaml", "src/**/*.gen.ts"],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
  /*
   * The browser parts and the dev server's plugin with their types, and the agent's
   * command. The source is the package's `exports`; a published copy reads `dist`
   * (`publishConfig`). The builds run at once, so none cleans `dist`: the `pack` script
   * empties it first.
   */
  pack: [
    {
      // The overlay for an app of any framework holds its own React and the rest, so it
      // needs no peer; its types name the dependencies' types. Its React is its own, so it
      // is React's production build. A browser has no use for the "use client" of
      // lucide's modules.
      entry: { index: "src/index.ts" },
      platform: "browser",
      tsconfig: "tsconfig.app.json",
      env: { NODE_ENV: "production" },
      deps: {
        alwaysBundle: [PRIVATE],
        onlyBundle: [PRIVATE],
        dts: { alwaysBundle: [], neverBundle: [PRIVATE] },
      },
      checks: { moduleLevelDirective: false },
      dts: true,
      clean: false,
    },
    {
      // The parts for a React app run on the app's React, its peer.
      entry: {
        react: "src/react.ts",
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
