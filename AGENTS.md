# Working in Blueline

- Use the words in `GLOSSARY.md`, one word for each thing. Add a word there when a new
  term is agreed.
- `docs/design.md` holds the agreed design and the plan. Record a decision that is hard to
  reverse as an ADR in `docs/adr/`.
- Use the latest stable release of Effect v4, never a release candidate. Use XState 6 alpha,
  pinned to an exact version ([ADR 0006](docs/adr/0006-xstate-6-alpha-pinned-exactly.md)).
  Keep both internal: the public API uses Promises and plain data.
- Commits: an imperative subject of at most 72 characters, and a body that says why. No
  agent attribution.
- Effect 4 marks its platform layer as unstable. `tsconfig.base.json` allows exactly those
  modules in `allowedUnstableApis`. Add a module there only when Effect has no stable way to
  do the job, and never silence the warning another way.
