import path from "node:path";
import { recommended } from "@effect/tsgo/oxlint-presets";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite-plus";
import { keep } from "./examples/review-demo/test/packed/serve.setup.ts";

/** What the overlay's own bundle holds: React, Effect, XState, lucide and what they need. */
const PRIVATE =
  /^(react|react-dom|scheduler|use-sync-external-store|use-isomorphic-layout-effect|effect|xstate|@xstate\/react|lucide-react)(\/|$)/u;

/** Where the browser tests take the package from: its source, or the built `dist`. */
const ENTRIES = {
  source: { main: "src/index.ts", react: "src/react.ts", variants: "src/part/variants.tsx" },
  packed: { main: "dist/index.js", react: "dist/react.js", variants: "dist/variants.js" },
};

/*
 * The demo app's tests in Chromium, with Blueline from its source or from the built package:
 * the overlay in its shadow roots, the keys and the lift as a reviewer uses them. The page
 * has no Tailwind, so nothing of the tools' look comes from the page.
 */
function browser(from: keyof typeof ENTRIES) {
  const at = (file: string) => path.join(import.meta.dirname, file);
  return {
    extends: true,
    resolve: {
      alias: [
        { find: /^@henrikkvamme\/blueline$/u, replacement: at(ENTRIES[from].main) },
        { find: /^@henrikkvamme\/blueline\/react$/u, replacement: at(ENTRIES[from].react) },
        { find: /^@henrikkvamme\/blueline\/variants$/u, replacement: at(ENTRIES[from].variants) },
      ],
    },
    test: {
      name: `browser-${from}`,
      include: [`examples/review-demo/test/${from === "packed" ? "**/" : ""}*.test.{ts,tsx}`],
      // The built package also loads by a script tag from `blueline serve`.
      ...(from === "packed"
        ? { globalSetup: ["examples/review-demo/test/packed/serve.setup.ts"] }
        : {}),
      browser: {
        enabled: true,
        // The page keeps its origin for a tag by hand (test/packed/serve.setup.ts).
        ...(from === "packed"
          ? { commands: { keep: (_: unknown, ...args: Parameters<typeof keep>) => keep(...args) } }
          : {}),
        provider: playwright(),
        headless: true,
        instances: [{ browser: "chromium" as const }],
        screenshotFailures: false,
      },
    },
  };
}

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
        // Tool configuration, the dev server's plugin, the channel it shares with
        // `blueline serve`, and the build's scripts run before the application runtime exists.
        files: ["*.config.ts", "src/vite.ts", "src/server/*.ts", "scripts/*.ts"],
        rules: { "effecttsgo/process-env": "off", "effecttsgo/node-builtin-import": "off" },
      },
    ],
  },
  fmt: {
    ignorePatterns: ["dist/**", "pnpm-lock.yaml", "src/**/*.gen.ts"],
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "node", include: ["test/**/*.test.ts"], exclude: ["test/packed/**"] },
      },
      // The plugin and the command as they are published, once `vp pack` built them.
      { extends: true, test: { name: "node-packed", include: ["test/packed/*.test.ts"] } },
      browser("source"),
      browser("packed"),
    ],
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
