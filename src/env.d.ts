// What the bundler tells a module: an app's Vite build sets DEV, so a build drops the dev
// tools' parts (part/variants.tsx).
interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
