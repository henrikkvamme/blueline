# Blueline

Blueline is a review tool for a web app in development. You walk the app in steps, compare
the designs of a part, and write notes on the page. Your coding agent gets the notes,
answers in the page, and applies the designs you keep.

**Status: design.** No package is published yet. The code came here from the private
repository where Blueline started. It builds, checks and tests here on Effect 4.0.6, XState
5.33.3 and TypeScript 7. Read [docs/design.md](docs/design.md) for the plan.

With Node 24 and pnpm, from the repository root:

- `pnpm install` installs the locked dependencies.
- `pnpm run check` formats, lints and type checks.
- `pnpm test` runs the tests.
- `pnpm run pack` builds the published files in `dist`.
- `pnpm run verify` runs all of them.
- `pnpm run demo` starts the review demo (`examples/review-demo`) at `http://localhost:4310`.

- [docs/manual.md](docs/manual.md) is the manual for the code as it is now.
- [GLOSSARY.md](GLOSSARY.md) gives the words that the tool, its docs and its agents use.
- [docs/design.md](docs/design.md) gives the findings, the package's shape and the plan.
- [docs/adr/](docs/adr/) records the decisions that are hard to reverse.

The package will be `@henrikkvamme/blueline`.

## Licence

MIT. See [LICENSE](LICENSE).
