# XState 6 alpha, pinned exactly

Blueline used the latest stable XState, 5.33.3. We move to XState 6 alpha, on Henrik's
decision of 2026-10-30, while it is still an alpha. Effect stays on its latest stable v4
release.

XState 6 has a smaller API. A transition is one function: it returns its target and a patch
of the context, and it queues its effects on `enq`. The action creators (`assign`, `raise`,
`emit`, `enqueueActions` and the others) and the guard helpers are gone. The session machine
reads as plain TypeScript, with no named actions or guards to look up.

Version 6 declares context, events and input as Standard Schemas. Effect Schema gives a
Standard Schema, so a machine can use the schemas that Blueline keeps already: the note
machine takes its context from `NoteSchema`. Effect actors fit too. Blueline's actors each
run an Effect, and the machine stops one by leaving its state. Version 6 keeps that, and its
`createAsyncLogic` gives each run an `AbortSignal` that aborts when the actor stops.
`Effect.runPromise` takes that signal, so a later actor can run an Effect with no stop code
of its own.

The risk is that the API changes from one alpha to the next, with no deprecation, until 6.0
is stable. So:

- Pin `xstate` and `@xstate/react` to exact versions, with no caret or tilde.
- Upgrade on purpose, one alpha at a time, in its own commit. Read the changelog first, and
  run the checks and all the tests.
- Move to the stable 6.0 release when it ships, and then to the latest stable release again.

## Consequences

XState stays internal, as Effect does: the public API uses Promises and plain data, so an
alpha never shows in an app's code. The overlay bundles its own XState, so an app that uses
XState 5 is not affected. The rule in `AGENTS.md` now allows the XState 6 alpha and keeps the
rule for Effect.
