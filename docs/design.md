# Design: Blueline as a standalone package

Status: agreed on 2026-10-25. The words are in [GLOSSARY.md](../GLOSSARY.md).

## Goal

Blueline must work in any repository, with any framework and any coding agent, and with
no manual work. A review should start with one line in an app and need nothing more until
the reviewer writes the first note.

## Where Blueline is now

Blueline started as a package in a private monorepo, and its code is now in this
repository. It has about 8,400 lines: an overlay in
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

| Time         | What happened                                                                                                    | Layer         |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ------------- |
| 24 Oct 19:12 | The agent starts a Monitor on the notes by hand. The Monitor expires at 30 minutes, and nothing starts it again. | delivery      |
| 25 Oct 11:41 | Henrik writes two notes. The page says "Sent, but no agent listens". The app gives no journeys.                  | delivery, app |
| 11:59        | The notes arrive 18 minutes late, after the agent repairs the service that sends them.                           | delivery      |
| 12:20        | The agent writes 12 steps by hand in about 25 minutes. Each step polls the page for a selector.                  | app           |
| 12:25        | Settle does not go to the next step. Henrik presses `y` again, which opens the step again.                       | overlay       |
| 12:29        | The app's `h j k l` take Blueline's keys.                                                                        | overlay       |
| 13:09        | The notes arrive as queued messages. Henrik: "it should steer".                                                  | delivery      |
| 13:25        | Henrik asks for progress. The agent posts plans by hand, and each plan is a new reply.                           | delivery      |

These parts worked, and they stay:

- The notes file keeps every note. A listener that starts late gets the old notes, with
  their age.
- A pin carries a selector, the element's text and screenshots.
- Replies have states (`working`, `replied`, `settled`) and blocks (plan, variants).
- The settles wait and go to the agent with the next note. The last settle asks the
  reviewer to finish the review, and Finish ends it.

## Decisions

| Decision            | Choice                                                                                                                             | Why                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Package             | `@henrikkvamme/blueline`, one package with subpaths: `/vite`, `/react`, `/foldkit`                                                 | One version and one maintainer. `blueline` on npm is taken.                       |
| Licence             | MIT, public                                                                                                                        | Cleared by the first app's owner                                                  |
| Effect              | The latest v4 release, never a release candidate. Internal.                                                                        | The app's own Effect version must not matter.                                     |
| XState              | The latest release. Internal.                                                                                                      | Same reason                                                                       |
| Overlay             | Today's React UI, bundled in a shadow root ([ADR 0001](adr/0001-bundle-the-overlay-in-a-shadow-root.md))                           | The app needs no React, Tailwind or Effect.                                       |
| Mount               | `blueline dev -- <cmd>` first, then a Vite plugin and a script tag ([ADR 0004](adr/0004-a-wrapper-command-is-the-first-way-in.md)) | Level 0 needs no code. The plugin and the tag cover the apps that a proxy breaks. |
| Delivery            | One server per machine ([ADR 0003](adr/0003-one-server-owns-delivery.md))                                                          | Notes must arrive with no agent that listens.                                     |
| No registered agent | The server starts one: the repository's last T3 thread while its cache is warm, else a new thread with a handoff                   | A note never waits unseen.                                                        |
| A note mid-turn     | It joins at the agent's next tool boundary                                                                                         | The agent sees it in seconds and loses no work.                                   |
| Agent side          | Nothing to install ([ADR 0002](adr/0002-notes-carry-their-own-instructions.md))                                                    | A plugin comes only if this shows limits.                                         |

### v1 must work for

- The React app at work, at Level 3.
- The dev dashboard, at Level 1.
- Any web app, at Level 0.
- A Next.js app, which proves the script tag and the server outside Vite.

## Shape

```
Browser                         Machine                          Agent
-------                         -------                          -----
Overlay (React, shadow root)    blueline serve                   CLI: dev, listen, reply, apply,
Core (plain TS):                  HTTP channel                        guide, doctor
  session machine,                notes and replies per repo      Delivery adapters:
  part store, registry,           registered agents                 T3 (send, steer)
  channel client                  delivery queue, retries           Codex app-server (turn/steer)
App adapters:                   blueline dev (proxy),               claude -p, codex exec
  React variants(),             Vite plugin or script tag:       Later, if needed:
  Foldkit subscription,           each starts the server            Claude Code plugin (hooks)
  data-blueline-part            Files per repo: .blueline/
```

The notes file and the replies file stay the record of a review. Everything around them is
an adapter that can change.

### Levels

Each level adds to the one before it. An app uses the lowest level that does the job.

| Level | The app holds                                                                 | The reviewer gets                            |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| 0     | Nothing with `blueline dev`, else one plugin line or a script tag             | Page notes, pins, screenshots, chat          |
| 1     | `blueline.config.ts`: journeys as data                                        | Journeys and steps                           |
| 2     | Parts: `variants()` in React, a Foldkit subscription, or `data-blueline-part` | Variants, states, the lift, `blueline apply` |
| 3     | An adapter in code, whose functions return Promises                           | Scenarios, acting as a person, setup in code |

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
            {
              label: "Folded in Intake",
              do: [{ emit: "dash:review", detail: { sourcesLook: "fold" } }],
            },
            {
              label: "To do column",
              do: [{ emit: "dash:review", detail: { sourcesLook: "column" } }],
            },
          ],
        },
      ],
    },
  ],
});
```

This is a sketch. The names can change while the code is built.

### Entry points

Every entry point loads the same overlay script. The core puts itself on `window`, so an
app's own code at Levels 2 and 3 finds it there, and the app does not bundle the overlay.

- `blueline dev -- <cmd>` runs the app's dev command behind a proxy. The proxy passes
  everything through, websockets too, and adds the script tag to each HTML page. It starts
  the app on a hidden port and takes the port that the app would have used, so the origin
  does not change. When it cannot move the app, it uses a new port and says what can break:
  sign-in redirects built from the origin, backend CORS lists and service workers.
- The Vite plugin adds the script tag and forwards Blueline's routes to the server. It
  needs no proxy.
- A script tag by hand works in any server that you control.

### The panel and its layers

Agreed on 2026-10-25, after Henrik's first review of the demo app.

- **One panel.** The step card moves into the sidebar. The panel shows the step's header
  (the step before and after, the step's number and title, Settle), the step's words, and
  the step's chat with its message field. While a step is open, the tree of pages and
  journeys folds to one line at the panel's top. Off a step, the panel shows the page's
  chat in the same place.
- **The panel pushes the page aside.** The page narrows by the panel's width, so the
  panel covers nothing. One visible button on the panel and Ctrl+B hide it and show it
  again. An element that the app pins to the right edge can still sit under the panel.
- **The bar is the folded panel.** When the panel is hidden, the bar shows the step's
  number and title, the step before and after, and Settle. The bar and the panel never
  show at once.
- **A pin's note card stays beside its pin** while the reviewer writes. A sent note joins
  the chat in the panel.
- **Three layers, each hidden on its own.** The page is at the bottom, the light is over
  it, and the panel is over the light.

| Action                       | The walk                          | Light                       | Panel                                                  |
| ---------------------------- | --------------------------------- | --------------------------- | ------------------------------------------------------ |
| Ctrl+B or the panel's button | stays on the step                 | stays                       | hides or shows                                         |
| Ctrl+P                       | stays on the step                 | hides                       | hides, and only the eye shows                          |
| Esc, with no field focused   | leaves the step for the page view | off                         | shows the page's chat                                  |
| A settle                     | goes on to the next open step     | turns green, then glides on | shows the next step                                    |
| The last settle              | waits on the step                 | turns green, and stays      | shows the finish                                       |
| Finish review                | ends: the journey is done         | off                         | shows the page's chat, and the journey goes to Settled |

Leaving a step changes the place. Hiding changes only the view. So Esc moves the reviewer,
and Ctrl+B and Ctrl+P only hide.

### Keys

Blueline takes a key in the capture phase while its panel or one of its fields has the
focus. Ctrl combinations always belong to Blueline. Other keys go to the app first.

One rule holds everywhere, as in the lift and the tree: across is the variant, down is the
step.

- `h` and `l` show the previous and the next variant. Ctrl+H and Ctrl+L do the same when
  the app takes `h` and `l`.
- `j` and `k` go to the step after and before. Ctrl+J and Ctrl+K do the same.
- Enter and `y` settle the step and go on to the next open step. Enter settles only when no
  control of the app has the focus, so Enter on the app's own button still clicks it.

### Settle

A settle shows that it took. The light's outline turns green, a clear green and not the blue
accent, and a check draws in its corner, for about 400 ms. The step's row in the tree gets
its check. Then the walk goes on to the next open step. Undo runs the same motion
backwards. With reduced motion, the colour changes with no movement, and the check only
fades in. On a phone, the same motion shows above the sheet. A settled step keeps its green
light.

A settle never lands on a step the reviewer has not seen: a key's auto-repeat does nothing,
and while the motion plays, and until the next step's light is in place, another settle does
nothing.

After a settle, and on `j` and `k`, the light moves to the next part: it waits while the
page scrolls there, glides from the old part's box to the new one in about 300 ms, eased
out, and gives one soft pulse. On another page it fades in instead. With reduced motion it
fades, with no glide or pulse.

The last settle does not end the walk. The panel shows the finish in place of the step:
"All 5 steps settled", the kept variant of each part, the number of notes sent, a primary
**Finish review** and a quiet **Back**. Enter presses Finish, but only an Enter pressed
after the finish shows. Back, Escape and undo open the last step again. The last step's
settle line, the one with `left: 0`, waits until Finish, so the agent wakes once. A reload
keeps the finish.

The tree keeps the open journeys on top. The settled ones stand folded at its foot, under a
quiet **Settled** heading; a finished journey moves there with a short motion, and back up
the same way for another pass.

## Requirements from the dev dashboard review

Henrik's second review of the dev dashboard, on 2026-10-25, found these problems. The move
must fix each one or design it out. The plan step that does it is in brackets.

1. **A settle keeps the variant shown, for every kind of variant.** A settle recorded the
   kept variant only for a part made with `variants()`. On a step with its own variants
   (`DevStep.variants` with `apply`), the line had no `keep` and no `parts`, so the agent had
   to ask which variant Henrik kept. Now each settle and each note carries the variant that
   the step and each of its parts show, by label. A step variant has no code call for
   `blueline apply` to change, so the line tells the agent to make that variant the app's
   own. [2]
2. **`v` lifts the design on a step with its own variants.** On such a step, `v` opened a
   list in a modal card. The lift draws a part's component once for each variant, and a step
   variant changes the whole page, so there was nothing to draw. Now `v` always shows the
   lift and never a modal. When the app marks the part (Level 2), the lift is live. When a
   step's variants only change the page, Blueline applies each variant in turn and shows a
   still copy of the step's target for it, in the same lift. [2]
3. **Delivery steers, and sends each line once.** The launchd service sent notes with
   `t3 thread send`, which queues behind a busy turn. It also sent the last settle to a
   thread whose agent had already read it: it waited for a live listener's agent to reply
   to a note, and a settle has no note to reply to. Now every line, settles too, has an ID.
   The server is the only sender. It records which agent got each line, and it never sends
   a line again. The T3 adapter steers a busy turn (`t3_thread_send` with `mode: steer`,
   through T3's MCP), and does not use the CLI. [4]
4. **No watcher that must be kept alive.** A listener under Claude Code's Monitor stopped
   after 30 minutes, and the agent had to start it again. Now the server delivers to a
   registered agent through its harness, so nothing in the agent must keep running. A bare
   session can run `blueline listen --once` as a background command. It ends at the first
   note, which wakes the agent, and the note says to run it again. [4]
5. **Progress shows by default.** The server marks a note `working` when it delivers it.
   The note's own instructions tell the agent to post its plan with
   `blueline reply ... working --blocks <file>` and to update that plan in place. [4, 6]
6. **The coupling cost of an app without React.** The dev dashboard, a Foldkit app, needed
   a `dash:review` window event and a dev-only field in its model to let Blueline set its
   state. A Level 1 step's `emit` removes the import of Blueline. The event and the model
   field stay in the app: that is the price of state that the address does not hold. A
   Foldkit part adapter at Level 2 lets the dashboard's variants become parts. [2, 5]

## Plan

Each step leaves the tool working.

1. **Move.** The code came here on 2026-10-25 as one import commit, with the last open
   change from the source repository (Settle goes to the next step, Ctrl+H/L, a plan that
   updates in place). It has no history, because the source repository's commit messages
   are internal. Next: make it build and test here, and move to the latest Effect v4 and
   XState, both internal. No change in behaviour.
2. **Split.** Take the core out of React. Bundle the overlay in a shadow root, with its CSS.
   Steps and adapters take Promises. React, Tailwind and Effect are no longer peers.
3. **Server.** Add `blueline serve`, `blueline dev`, the Vite plugin and the script tag.
   The dev dashboard drops its import aliases. Level 0 works in any app with no code.
4. **Delivery.** Add registered agents and the delivery adapters: T3 with steer, the Codex
   app-server, and starting an agent. Retire the launchd service.
5. **Journeys as data.** Add `blueline.config.ts`. The dev dashboard moves its steps there.
6. **Agent guide.** Add `blueline guide` and `blueline doctor`. Notes carry their own
   instructions. The React app at work moves to the npm package, and the old package
   leaves its repository.
7. **Next.js.** Prove `blueline dev` and the server in a Next.js app.

## Evals

Evals come after the build, once the design and the behaviour are agreed in real use.

- Each fixture is a small synthetic app: React with Vite, Vue with Vite, SvelteKit,
  Next.js and plain HTML.
- A task is a short prompt for one level, such as "let me review the home page" or "give
  me two designs for the header".
- A scripted reviewer posts notes and settles through the page's routes. It checks that
  the agent replies, makes the change and applies the verdicts.
- Mechanical checks come first: the overlay loads, each target is on the page, the
  variants render, and the replies arrive in time. A judge model then scores the journeys'
  words and the variants against a rubric, and Henrik checks a few runs.
- Most runs use Claude Code. Some runs use other harnesses (Codex, T3), to prove that
  nothing depends on one agent.

## To verify while building

- Whether still copies of a step's target (requirement 2) look right on the dev dashboard,
  whose styles come from the page and not from the part.

- T3's MCP steer for an outside process: the public docs do not show it yet.
- Whether an outside process can reach a running Codex TUI through the app-server.
- How `blueline apply` treats a part that is marked with `data-blueline-part` and not a
  `variants()` call.
