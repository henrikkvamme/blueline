# Design: Blueline as a standalone package

Status: agreed on 2026-10-25. The words are in [GLOSSARY.md](../GLOSSARY.md).

## Goal

Blueline must work in any repository, with any framework and any coding agent, and with
no manual work. A review should start with one line in an app and need nothing more until
the reviewer writes the first note.

## Where Blueline is now

Blueline started as a package in a private monorepo. It has about 8,400 lines: an overlay in
React, a session machine in XState, a channel on the Vite dev server, and a command for the
agent (`listen`, `review`, `reply`, `apply`). Two apps use it:

- A React app at work, at Level 3: scenarios, acting as a person, journeys in code and parts
  with variants.
- Henrik's dev dashboard, a Foldkit app (not React). It loads Blueline from the other
  repository's folder on disk, with import aliases and a separate React root.

Outside the package, a launchd service sends notes to a T3 Code thread, and a skill tells
the agent what to do. Both name the first app's paths.

## What a real review showed

The only full review in the transcripts is on the dev dashboard, on 24 and 25 October 2026.

| Time | What happened | Layer |
| --- | --- | --- |
| 24 Oct 19:12 | The agent starts a Monitor on the notes by hand. The Monitor expires at 30 minutes, and nothing starts it again. | delivery |
| 25 Oct 11:41 | Henrik writes two notes. The page says "Sent, but no agent listens". The app gives no journeys. | delivery, app |
| 11:59 | The notes arrive 18 minutes late, after the agent repairs the service that sends them. | delivery |
| 12:20 | The agent writes 12 steps by hand in about 25 minutes. Each step polls the page for a selector. | app |
| 12:25 | Settle does not go to the next step. Henrik presses `y` again, which opens the step again. | overlay |
| 12:29 | The app's `h j k l` take Blueline's keys. | overlay |
| 13:09 | The notes arrive as queued messages. Henrik: "it should steer". | delivery |
| 13:25 | Henrik asks for progress. The agent posts plans by hand, and each plan is a new reply. | delivery |

These parts worked, and they stay:

- The notes file keeps every note. A listener that starts late gets the old notes, with
  their age.
- A pin carries a selector, the element's text and screenshots.
- Replies have states (`working`, `replied`, `settled`) and blocks (plan, variants).
- The settles wait and go to the agent with the next note. The last settle ends the review.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Package | `@henrikkvamme/blueline`, one package with subpaths: `/vite`, `/react`, `/foldkit` | One version and one maintainer. `blueline` on npm is taken. |
| Licence | MIT, public | Cleared by the first app's owner |
| Effect | The latest v4 release, never a release candidate. Internal. | The app's own Effect version must not matter. |
| XState | The latest release. Internal. | Same reason |
| Overlay | Today's React UI, bundled in a shadow root ([ADR 0001](adr/0001-bundle-the-overlay-in-a-shadow-root.md)) | The app needs no React, Tailwind or Effect. |
| Mount | A Vite plugin, and a script tag for other dev servers | Covers Vite apps and Next.js. An extension or a TanStack Devtools plugin can come later. |
| Delivery | One server per machine ([ADR 0003](adr/0003-one-server-owns-delivery.md)) | Notes must arrive with no agent that listens. |
| No registered agent | The server starts one: the repository's last T3 thread while its cache is warm, else a new thread with a handoff | A note never waits unseen. |
| A note mid-turn | It joins at the agent's next tool boundary | The agent sees it in seconds and loses no work. |
| Agent side | Nothing to install ([ADR 0002](adr/0002-notes-carry-their-own-instructions.md)) | A plugin comes only if this shows limits. |

### v1 must work for

- The React app at work, at Level 3.
- The dev dashboard, at Level 1.
- Any web app, at Level 0.
- A Next.js app, which proves the script tag and the server outside Vite.

## Shape

```
Browser                         Machine                          Agent
-------                         -------                          -----
Overlay (React, shadow root)    blueline serve                   CLI: listen, reply, apply,
Core (plain TS):                  HTTP channel                        guide, doctor
  session machine,                notes and replies per repo      Delivery adapters:
  part store, registry,           registered agents                 T3 (send, steer)
  channel client                  delivery queue, retries           Codex app-server (turn/steer)
App adapters:                   Vite plugin / script tag            claude -p, codex exec
  React variants(),               starts the server if needed      Later, if needed:
  Foldkit subscription,         Files per repo: .blueline/          Claude Code plugin (hooks)
  data-blueline-part
```

The notes file and the replies file stay the record of a review. Everything around them is
an adapter that can change.

### Levels

Each level adds to the one before it. An app uses the lowest level that does the job.

| Level | The app holds | The reviewer gets |
| --- | --- | --- |
| 0 | One plugin line or a script tag | Page notes, pins, screenshots, chat |
| 1 | `blueline.config.ts`: journeys as data | Journeys and steps |
| 2 | Parts: `variants()` in React, a Foldkit subscription, or `data-blueline-part` | Variants, states, the lift, `blueline apply` |
| 3 | An adapter in code, whose functions return Promises | Scenarios, acting as a person, setup in code |

A step at Level 1 is data, so the server can send it to the page and reload it when the file
changes. A step's actions are `open` a path, `click`, `type`, `press`, `wait` for a selector
and `emit` a window event. With `emit`, an app can keep its own event, as the dev dashboard
does, and import nothing from Blueline.

```ts
import { defineConfig } from "@henrikkvamme/blueline/config";

export default defineConfig({
  url: "http://localhost:4300",
  journeys: [
    {
      id: "overview",
      title: "Overview",
      steps: [
        {
          id: "overview-sources",
          group: "Sidebar",
          title: "Sources",
          look: "The Jira issues that are not yet a Feature, three ways.",
          do: [{ open: "/" }, { click: '[data-card="sources"]' }, { wait: ".ov-dock" }],
          target: [".ov-stages", ".ov-cells", ".ov-dock"],
          variants: [
            { label: "Folded in Intake", do: [{ emit: "dash:review", detail: { sourcesLook: "fold" } }] },
            { label: "To do column", do: [{ emit: "dash:review", detail: { sourcesLook: "column" } }] },
          ],
        },
      ],
    },
  ],
});
```

This is a sketch. The names can change while the code is built.

### Keys

Blueline takes a key in the capture phase while its sidebar or one of its fields has the
focus. Ctrl combinations always belong to Blueline. Other keys go to the app first.

## Plan

Each step leaves the tool working. Code moves only after the source repository's last
open change to Blueline has landed (Settle goes to the next step, Ctrl+H/L, a plan that
updates in place).

1. **Move.** Copy `packages/blueline` here with its history (`git filter-repo`). Rename it.
   Move to the latest Effect v4 and XState, both internal. No change in behaviour.
2. **Split.** Take the core out of React. Bundle the overlay in a shadow root, with its CSS.
   Steps and adapters take Promises. React, Tailwind and Effect are no longer peers.
3. **Server.** Add `blueline serve`, the Vite plugin that starts it, and the script tag.
   The dev dashboard drops its import aliases. Level 0 works in any app.
4. **Delivery.** Add registered agents and the delivery adapters: T3 with steer, the Codex
   app-server, and starting an agent. Retire the launchd service.
5. **Journeys as data.** Add `blueline.config.ts`. The dev dashboard moves its steps there.
6. **Agent guide.** Add `blueline guide` and `blueline doctor`. Notes carry their own
   instructions. The React app at work moves to the npm package, and the old package
   leaves its repository.
7. **Next.js.** Prove the script tag and the server in a Next.js app.

## To verify while building

- T3's MCP steer for an outside process: the public docs do not show it yet.
- Whether an outside process can reach a running Codex TUI through the app-server.
- How `blueline apply` treats a part that is marked with `data-blueline-part` and not a
  `variants()` call.
