# Vendored code

- `cua-cursor-motion.js` and `.d.ts`: the agent cursor of Cua Driver, `@trycua/cursor-motion`,
  built from [trycua/cua](https://github.com/trycua/cua/tree/main/libs/typescript/cursor-motion)
  at commit `2d974f1843c7343a70affba9d21e7362979edec3` with
  `pnpm --filter @trycua/cursor-motion build`. It is not on npm. MIT licence, copyright 2025
  Cua AI, Inc. To update it, build it again and copy `dist/index.js` and `dist/index.d.ts`.
