# Blueline

Blueline is a review tool for a web app in development. You walk the app in steps, compare
the designs of a part, and annotate the page. Your coding agent gets your messages and
annotations, answers in the page, and applies the designs you keep.

**Status: early.** The package is published on npm as
[`@henrikkvamme/blueline`](https://www.npmjs.com/package/@henrikkvamme/blueline). Its API can
still change between minor versions. It builds, checks and tests on Effect 4.0.6, XState 5.33.3
and TypeScript 7. Read [docs/manual.md](docs/manual.md) to use it, and
[docs/design.md](docs/design.md) for the plan.

```sh
pnpm add -D @henrikkvamme/blueline
```

With Node 24 and pnpm, from the repository root:

- `pnpm install` installs the locked dependencies, and `pnpm exec playwright install
  chromium` the browser for the browser tests.
- `pnpm run check` formats, lints and type checks.
- `pnpm test` runs the tests: in Node, and the demo in Chromium with Blueline from its source.
- `pnpm run pack` builds the published files in `dist`.
- `pnpm run test:packed` runs the demo's tests in Chromium on the built `dist`.
- `pnpm run verify` runs all of them.
- `pnpm run demo` starts the review demo (`examples/review-demo`) at `http://localhost:4310`.

- [docs/manual.md](docs/manual.md) is the manual for the code as it is now.
- [GLOSSARY.md](GLOSSARY.md) gives the words that the tool, its docs and its agents use.
- [docs/design.md](docs/design.md) gives the findings, the package's shape and the plan.
- [docs/adr/](docs/adr/) records the decisions that are hard to reverse.

## Licence

MIT. See [LICENSE](LICENSE).
