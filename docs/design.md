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

| Decision            | Choice                                                                                                                                                             | Why                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Package             | `@henrikkvamme/blueline`, one package with subpaths: `/vite`, `/react`, `/foldkit`                                                                                 | One version and one maintainer. `blueline` on npm is taken.                       |
| Licence             | MIT, public                                                                                                                                                        | Cleared by the first app's owner                                                  |
| Effect              | The latest v4 release, never a release candidate. Internal.                                                                                                        | The app's own Effect version must not matter.                                     |
| XState              | The latest release. Internal.                                                                                                                                      | Same reason                                                                       |
| Overlay             | Today's React UI, bundled in a shadow root ([ADR 0001](adr/0001-bundle-the-overlay-in-a-shadow-root.md))                                                           | The app needs no React, Tailwind or Effect.                                       |
| Mount               | `blueline dev -- <cmd>` first, then a Vite plugin and a script tag ([ADR 0004](adr/0004-a-wrapper-command-is-the-first-way-in.md))                                 | Level 0 needs no code. The plugin and the tag cover the apps that a proxy breaks. |
| Delivery            | One server per machine ([ADR 0003](adr/0003-one-server-owns-delivery.md)); agents pull, adapters wake ([ADR 0005](adr/0005-agents-pull-and-adapters-only-wake.md)) | Notes must arrive with no agent that listens.                                     |
| No registered agent | The server starts one: the repository's last T3 thread while its cache is warm, else a new thread with a handoff                                                   | A note never waits unseen.                                                        |
| A note mid-turn     | It joins at the agent's next tool boundary                                                                                                                         | The agent sees it in seconds and loses no work.                                   |
| Agent side          | Nothing to install ([ADR 0002](adr/0002-notes-carry-their-own-instructions.md))                                                                                    | A plugin comes only if this shows limits.                                         |

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

- **One panel.** The step card moves into the sidebar. The panel is calm: one accent, flat
  tints, few text sizes, and no key labels. The keys are in the `?` menu.
- **Its top line.** The journey's title, in muted text, is a button that unfolds the tree.
  After it come the journey's progress as dots, one for each step: green when settled, grey
  when open, and the step shown as a wider blue pill. A journey of more than 10 steps shows a
  thin bar in the same room: the settled share in green, the step's place in blue, and the
  step's number, as "3 of 14". Then **More** and **Hide**. More holds
  Reset the step, Next reply, Hide the tools (the preview), Undo and the `?` keys. Next reply
  is grey when no reply is new. Hide stays visible, beside Ctrl+B.
- **The step fills the panel.** A faint line gives the step's number and group. Under it are
  the step's title, large, then what to look at and what to try, in muted words.
- **One control for the variants.** When the step has more than one variant, of its part or
  its own, a **Variants** list shows them as radio rows, with a quiet **Lift** at its right.
  The row of the variant shown is raised. A click on a row shows that variant on the page, as
  `j` and `k` do. A deleted variant has no row. The states show only in the lift.
- **The chat fills the rest, and scrolls.** It is the step's chat. When the page's chat has
  messages, a quiet button at the chat's top opens it, and **Back to the step** returns. Tab
  in the message field also switches.
- **The message field wraps as a chat app's does.** While the words fit on one line, the
  field is one row: + at the left, the field, and **Annotate**, the pin, beside send at the
  right. Once the
  words wrap, the field spans the box on top and grows down, and the buttons go to a row under
  it. It goes back to one row when the words fit again. A copy of the words out of sight, at
  the one row's width, says which form, before the browser paints, so nothing flickers. Only
  the layout changes, so the field keeps its focus, caret and scroll. The box grows upward
  into the chat, and the foot under it does not move. The vim mode's badge stands on the
  box's top edge at the left, over no word in either form. An annotation card's field works
  the same way.
- **A fixed foot.** Under the message field, a bar holds the step before, Settle and the step
  after, as a left and a right chevron. Settle is the one primary button, as wide as the room
  between the chevrons. On a step that lists variants it names the variant it keeps, as
  **Keep Cards**, and the name changes as the reviewer goes through the variants. On a settled
  step that shows its kept variant it reads **Kept Cards**, or **Settled** on a step with no
  variants, in green, and a press goes on. On a settled step that shows another variant it
  turns blue again and reads **Keep Table**. Its width never changes: a long name ends in an
  ellipsis. The
  foot does not move from step to step. A click on a step control leaves the focus where it
  was, so Enter still settles.
- **Off a step**, the panel shows the tree and the page's chat, with the same top line, type
  sizes, row height and radius. One quiet line parts the tree from the chat. The message
  field's words name the chat, as "A message on this page". The panel has one hint, and only
  where the design cannot teach: on a page with no journey and no part with variants, the
  empty chat says "Alt+click anything to annotate it." It goes with the first message or
  annotation. A phone does not show it, as its message field's Annotate button does the job.
- **The panel pushes the page aside.** The page narrows by the panel's width, so the
  panel covers nothing. One visible button on the panel and Ctrl+B hide it and show it
  again. An element that the app pins to the right edge can still sit under the panel.
- **The bar is the folded panel.** When the panel is hidden, the bar shows the step's
  number and title, the step before and after, and Settle. The bar and the panel never
  show at once.
- **The lift's bar is calm.** It holds the part's name, the variant and the state, **Use**
  and **Close**, and a ⋯ menu. Use is the one primary button, in blue, and puts the variant
  shown on the page. Close, as Esc, closes the lift and keeps the page as it was. The ⋯ menu
  is the panel's menu, and holds Delete, Annotate, Next annotation, Undo and Zoom; each keeps its key.
  The variant and the state keep the width of their widest value, and the count has tabular
  digits, so the bar keeps its width while they change. On a phone the bar has two lines,
  with 44 px targets.
- **A pin's annotation card stays beside its pin** while the reviewer writes. Enter in the
  card sends the annotation at once, as a message with its pin, and it joins the chat in the
  panel. Cmd+Enter, or Ctrl+Enter off a Mac, and a quiet **Later** beside the send arrow keep
  the annotation on its pin: it waits, its chip stands over the message field, and it goes with the
  next message. The `?` menu lists both keys. While the chat's message field holds words, the annotation joins them instead: Enter keeps
  it, its chip stands over the field, and it goes with that message. The card's button shows
  which, with no words: a blue send arrow, or a grey check.
- **Three layers, each hidden on its own.** The page is at the bottom, the light is over
  it, and the panel is over the light.

| Action                       | The walk                          | Light                       | Panel                                           |
| ---------------------------- | --------------------------------- | --------------------------- | ----------------------------------------------- |
| Ctrl+B or the panel's button | stays on the step                 | stays                       | hides or shows                                  |
| `p`, or Hide the tools       | stays on the step                 | hides                       | hides, and only the eye shows                   |
| Esc, with no field focused   | leaves the step for the page view | off                         | shows the page's chat                           |
| A settle                     | goes on to the next open step     | turns green, then glides on | shows the next step                             |
| The last settle              | waits on the step                 | turns green, and stays      | shows the finish                                |
| Finish review                | ends: the journey is done         | off                         | shows the tree, and the journey goes to Settled |

Leaving a step changes the place. Hiding changes only the view. So Esc moves the reviewer,
and Ctrl+B and `p` only hide.

### Keys

Agreed with Henrik on 2026-10-26.

Rule changed on 2026-10-26, so that an app with its own keys needs no code.

One rule decides who gets a key. While Blueline owns the page's keys, it takes each key that
it binds in the capture phase on `window`, and stops it there: the app's handlers never see
it. Blueline owns the page's keys on a step, on the finish, on the hand-off, in the lift, in
the preview, while `m` aims and while a menu of Blueline's is open. Off a step, on the page
with the tree, the app gets each key first, and Blueline takes only what the app leaves.
`keymap.ts` `captured` holds the rule, and its tests check it.

| Mode                     | Focus                                  | Who gets the key                                      |
| ------------------------ | -------------------------------------- | ----------------------------------------------------- |
| any                      | a field, select or editable, the app's | the app, but Ctrl+B on a step                         |
| any                      | a field or open list of Blueline's     | that field or list                                    |
| any                      | Blueline's tree                        | Blueline, first                                       |
| Blueline owns the keys   | the page                               | Blueline, first, for each key it binds                |
| Blueline owns the keys   | a control of the app's                 | the control for Enter, Space and arrows; else as page |
| the lift                 | the page or a control                  | the lift, first, for every key                        |
| off a step, nothing open | the page or a control                  | the app first; Blueline after, as before              |
| any                      | any                                    | the app, for a key Blueline does not bind             |

On every step, `j`, `k` and the digits are Blueline's, also when the step has one variant, so they never move the app under the review. The arrows go to the page on such a step, where they scroll it. A key with Ctrl, Cmd or Alt that Blueline does not bind is the app's. Ctrl+B, Ctrl+R,
Ctrl+Z, Cmd+Z, Ctrl+Shift+Z and Cmd+Shift+Z are Blueline's while it owns the keys. A control
of the app's is a button, a link, a slider, tabs or another element that uses the key
(`zoneOf` and `isControl`). An app that listens on `window` in the capture phase, and adds its
listener before Blueline, still sees the keys first. No key needs AltGr or Option on a
Norwegian Mac, so no key is `[ ] { } \ | @ $ ~` or a backtick.

Blueline tells the app what the walk does with `data-blueline` on the page's root element:
`step`, `finish`, `handoff`, `lift` or `preview`. The attribute is gone while Blueline is idle
or shows the page with the tree. It is the one supported way for an app to know; the storage format is not.

The keys move the way things stand on the screen, and each arrow key does what its vim key
does. On a step, the panel's foot goes across: the step before, Settle and the step after.
The variants stand in a list down the panel.

| Key                               | What it does                                              |
| --------------------------------- | --------------------------------------------------------- |
| `h`, `l`, ←, →                    | the step before, the step after                           |
| `j`, `k`, ↓, ↑                    | the next, the previous variant in the panel's list        |
| `1` to `9`                        | the variant with that number                              |
| `H`, `L`, Shift+←, Shift+→        | the open step before, after: settled steps are skipped    |
| `g g`, `G`                        | the first, the last open step                             |
| `y`, Enter                        | settle the step, or keep the variant shown; then go on    |
| `v`, Space                        | lift the part; again, close the lift                      |
| `i`                               | write a message                                           |
| `m`, then a click                 | annotate the element clicked; Esc stops                   |
| `u`, Ctrl+Z, Cmd+Z                | undo                                                      |
| Ctrl+R, Ctrl+Shift+Z, Cmd+Shift+Z | redo                                                      |
| Esc                               | back one level                                            |
| `p`                               | the preview: a tap hides or shows the tools; held, a peek |
| Ctrl+B                            | hide the panel, or show it again                          |
| `?`                               | the keys                                                  |

- The arrow keys and Space act only on a step, and only while the focus is on the page
  itself. On a field, a select, a slider, tabs or another control that uses them, they stay
  the app's. Off a step, they scroll the page.
- Enter settles only when no control of the app has the focus, so Enter on the app's own
  button still clicks it. A held `y` or Enter settles once.
- `p` acts at once as it goes down. When it comes up after 200 ms or more, it acts again, so
  a hold only peeks.
- The lift keeps its own keys: across through the variants with `h`, `l`, ← and →, and down
  through the states with `j`, `k`, ↓ and ↑. `v`, Space and Esc close the lift. The tree
  keeps its own keys too: `j` and `k` select a row, `l` and `h` open and close it, and
  Ctrl+J and Ctrl+K select the open steps. In the tree, the arrows scroll.

### Settle

A settle goes on at once. The session settles the step, and the panel shows the next open
step: the first open one after it, or with none after, the journey's first open step. The step's row in the tree gets its check. At the same time the old part shows that
the settle took: its outline turns green, a clear green and not the blue accent, and a check
draws in at its corner. The outline and the check then fade, while the light glides from the
old part to the new one. The whole motion takes about 250 ms. With reduced motion, nothing
moves: the green outline and the check only fade, and the light fades in on the new part. On
a phone, the same motion shows above the sheet. A settled step keeps its green light, so a
walk back to it shows that it is settled. Undo runs the motion backwards: the light comes
back to the step green, and turns blue as its check draws out.

The primary action has one meaning everywhere: this is right, go on. It reads the step and
the variant the page shows:

| The step                        | Settle reads           | A press                                    |
| ------------------------------- | ---------------------- | ------------------------------------------ |
| open                            | Keep Cards, or Settle  | settles it with Cards, and goes on         |
| settled, shows its kept variant | Kept Cards, or Settled | goes on, with no line and no change        |
| settled, shows another variant  | Keep Table, in blue    | keeps Table in place of Cards, and goes on |

A settled step that keeps another variant keeps only that one. The old variant is kept no
more, as if it never was, and it is not deleted: the step's `parts` verdict has
`kept: ["Table"]`, as a first settle writes it. One settle line goes with the new `parts`, the
green motion plays, and undo takes the step back to the old variant with its own line. The
walk comes to a settled step with its kept variant on the page, so Settle starts green. In the
panel's list of variants, a small green check marks the kept variant, apart from the radio of
the variant shown. Settle never opens a step again. `u` right after a settle does, and so does
**Open the step again** in the panel's ⋯ menu on a settled step. In the tree, `y` on a
settled step still opens it again.

A settle never lands on a step the reviewer has not seen: a key's auto-repeat does nothing,
and until the next step's light is in place, another settle does nothing. So a held `y`, or
a quick burst of `y`, settles one step.

On `h` and `l`, the light moves to the next part: it waits while the page scrolls there,
glides from the old part's box to the new one in about 250 ms, eased out, and gives one soft
pulse. After a settle it glides at once, and follows the part as the page scrolls. On another
page it fades in instead.

The last settle does not end the walk. The light turns green where it stands, and the
panel shows the finish in place of the step: "All 5 steps settled", the kept variant of each part, the number of messages and annotations sent, a primary
**Finish review**, with a send icon, in the place of Settle, and a back chevron in the place
of the step before. Enter presses Finish, but only an Enter pressed after the finish shows.
The back chevron, Escape and undo open the last step again. The last step's
settle line, the one with `left: 0`, waits until Finish, so the agent wakes once. A reload
keeps the finish.

Finish ends the walk. Agreed with Henrik on 2026-10-26: the panel goes straight back to the
page view with the tree. No step is open, and no view holds the panel. As off any step, the
tree has the keys, and the finished journey's row is selected. The finished journey's row, under **Settled**, carries the hand-off's state in place: a
small mark, and a short line under its title. The line reads "Sent", then "Working" with the
item of the plan that the agent is on, then "Replied" with the first line of the reply, or
"Taken back". A click on the row, or Enter on it in the tree, opens the **hand-off**, and
only then does `data-blueline` read `handoff`.

The hand-off's title reads "Sent to the agent", and the same rows stay: the kept variant of each part and the messages and annotations sent. Under them
the agent's part shows, and it changes in place. First a small pulsing dot says "Waiting for
the agent". When the agent writes `working`, the dot says "The agent is working", and the
agent's plan shows under it, in place of the last plan. When the agent writes `replied`, the
reply shows as a chat shows one. A quiet **Take back** and **Done** stand in the foot. Done,
Escape, or the title at the panel's top leaves the hand-off for the tree. A reload keeps the
hand-off.

The agent answers the review on the hand-off's ID. Each Finish makes a new hand-off, a note
with the ID `finish-<journey>-<time>`, and the last settle line carries it as `id`, with a
`reply` hint. An answer to an earlier pass never shows on a new one. The agent's answers to
the messages in the review's chats stay in those chats. While the agent has the hand-off, or its
reply is not read, the settled journey's row shows its line and mark, and the row opens the
hand-off and not another pass. Done after a reply settles the hand-off, so the reply counts
as news no more, and the row starts another pass again. A reply is news: a toast tells of it
while the hand-off is not in view, and opens it on request. Nothing opens by itself.

Each change of a step's settled state, or of the variant a settled step keeps, writes the
step's settle line: a settle, a settle that keeps another variant, Open the step again, undo,
redo, another pass over a settled journey, and a message on a settled step. Each line counts
the steps left after it. So the agent never keeps a settle that the page took back. Only the
last settle waits, for Finish, and has no line until then. While it waits, its step counts as
open in every other line, so no line but Finish's says `left: 0`. A held step that keeps
another variant still waits, and Finish sends the new one. After Finish, a settled step that
keeps another variant writes its line with `left: 0`, as every step is settled: the agent
applies the new variant.

The page review is one more journey, **This page**, with a step for each part that the page
shows. It is first under the journeys, and it starts open. It walks its parts with the same
panel, Settle, Finish and hand-off as any journey, so the reviewer learns one model. The page's
row keeps only its chat and its annotations. The feedback lines do not change: the journey is
`page`, a step's id is `page:<part>`, and its group is the page's path.

The tree keeps the open journeys on top. The settled ones stand folded at its foot, under a
quiet **Settled** heading; a finished journey moves there with a short motion, and back up
the same way for another pass. The hand-off replaces the "Review done" line that the tree's
foot had before, so the review's end has one place.

### Take back

Agreed with Henrik on 2026-10-26, in place of a five second wait before each send. A send
goes at once: a message, an annotation sent from its card, and Finish. After it went, the
reviewer can cancel it with **Take back**. Blueline does not interrupt the agent, as it can
work on other things. It writes one follow-up instead.

- A message in a step's chat or the page's, with or without annotations, has a quiet **Take
  back** under it. It shows on hover and on focus, and always on a phone. The hand-off has
  **Take back** in its foot.
- Take back writes one note line in the same chat, as any message, so the listener and the
  dispatcher deliver it with no change. Its one new field, `withdraws`, names what it takes
  back: `{ id, at }` for a message, by its chat's ID and its time, and `{ id }` for a finish,
  by its hand-off's ID.
- The thread's last entry holds the words. Blueline writes them, not the reviewer. They quote
  the message's first words, about 60 characters, and its time, or name the finished journey.
  They tell the agent to ignore it, to stop work on it if it started, not to undo changes
  unless the reviewer asks, to wait for the next message, and to reply to confirm.
- The message shows struck through, with a quiet **Taken back**. The follow-up shows as a small
  line of the chat's own, not as the reviewer's bubble, and the agent's reply comes under it.
  A finish taken back reads **Taken back** on its hand-off and its row. The journey stays
  settled, so the reviewer can settle again or start another pass.
- Each message and each finish is taken back once, and a follow-up has no Take back.
- A send is not undoable: `u` takes back the settles and the other changes, and never a
  message. Take back is the one way.

### Annotation, and the wire's note

Agreed with Henrik on 2026-10-26. The reviewer's word for what they write on a pin is
**annotation**. Each string on the screen, the `?` menu and the docs say it. The pin button
beside send reads **Annotate**. A **message** is still what the message field sends.

The wire format keeps its words: a line's `kind: "note"`, `pins` and `sentWords`, the chat
IDs `note-<step>`, and the CLI's `<note id>`. The code keeps its `Note` type. These
words stay on the wire for good (slice W0, 2026-10-26): other readers, as the dev dashboard,
parse them, and the format version `v` lets a later change move every reader at once.

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
   One agent claims each line, and it never gets that line again. Since ADR 0005 (2026-10-26),
   no sender breaks into a turn: an agent in a turn, also a T3 thread, pulls its lines at its
   next tool call through its harness hooks, or with `wait_for_feedback`. The T3 adapter only
   wakes an idle thread, and `t3 thread send` is enough for that. [4]
4. **No watcher that must be kept alive.** A listener under Claude Code's Monitor stopped
   after 30 minutes, and the agent had to start it again. Now an agent's harness hooks pull
   its lines, and an adapter wakes it when it is idle, so nothing in the agent must keep
   running. A bare
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
4. **Delivery.** Pull first: `blueline mcp` and harness hooks for an agent in a turn. Wake
   adapters (`claude`, `codex`, `t3`, `command`) only for an idle agent. Retire the launchd
   service. ADR 0005 records the change from ADR 0003's push design and the cache rules.
5. **Journeys as data.** Add `blueline.config.ts`. The dev dashboard moves its steps there.
6. **Agent guide.** Add `blueline guide` and `blueline doctor`. Notes carry their own
   instructions. The React app at work moves to the npm package, and the old package
   leaves its repository.
7. **Next.js.** Prove `blueline dev` and the server in a Next.js app.

### Build order (2026-10-26)

Step 1 is done. Steps 2 to 5 now land together, so that the dev dashboard runs on the
agnostic package. First, the `review-demo` branch merges into `main`. Then each slice lands
on `main` with its tests, and the demo works after each. A slice owns its files. A file
that two slices need has one owner, and the other slice waits for it.

| Slice | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Depends on     | Owns                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------- |
| W0    | The wire contract and the CLI seam. Done 2026-10-26. The server gives every line its own ID (`line`) and the format version (`v`); a line from before has its place in bytes as its ID. The wire keeps `kind: "note"`: other readers, as the dev dashboard, parse it, and a new word would break them for no gain. Each reader keeps a named cursor by line `id`, not by byte. A claim is atomic: under one lock file, a reader reads the lines after its cursor, skips each line another reader claimed, records its claims and moves its cursor, so a pull and a wake never both take a line. The replies are written under the same lock. Tests: two readers at once take each line once; two replies at once both stay. `bin/blueline.ts` dispatches each command to its own module. | -              | `bin/`, `src/io/lines`, `package.json` `bin`    |
| D0    | Done: [ADR 0005](adr/0005-agents-pull-and-adapters-only-wake.md). How each harness hooks up and registers, how Blueline knows an agent is busy, idle or absent, the fallback for a harness with no setup, and the cache rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | research       | `docs/adr`                                      |
| A1    | Extract the core behind the React facade. `src/core` holds the session machine, the part store, the registry, the channel client and the keymap, with no React import. `DevTools` keeps its props and mounts the core. The public API does not change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | W0             | `src/core`, `src/session`, `src/keys`           |
| A2    | The Promise API. `mount(options)` returns a handle with `dispose()`; the core on `window.blueline`. Steps and adapters take Promises and an `AbortSignal`, which aborts when the step changes or the overlay unmounts; a late result is dropped. People become a list or a Promise, not a hook. Tests: rapid steps, remount, a Promise that ends after navigation.                                                                                                                                                                                                                                                                                                                                                                                                                       | A1             | `src/types.ts`, `src/index.ts`, the demo        |
| A3    | The bundled overlay in a shadow root. Focus, key and click checks use the shadow root's `activeElement` and `composedPath()`; queries for Blueline's own nodes look in the shadow root, and queries for targets look in the page. Live part previews render in the page, so they keep the app's styles. Browser tests in a real shadow root: typing in the composer, tree keys, menus, the lift. No React, Tailwind or Effect peer.                                                                                                                                                                                                                                                                                                                                                      | A2             | `src/ui`, `src/part/lift.tsx`, `vite.config.ts` |
| A4    | Parts without React. `blueline.part(name, { variants, states, show })` and `data-blueline-part`. `variants()` in `/react` uses it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A2             | `src/part`, `/react`                            |
| A5    | Still copies for step variants. For a variant that is not a part: apply it, wait until it is ready, copy its targets with the page's styles, restore the page, and show the copies in the lift. Tests on a fixture with no React: Use, Close, and a step change in the middle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A3, D1         | `src/part/still.ts`                             |
| B1    | `blueline serve`, one per machine. A repository is the `git` top level of the app's root, by real path; a worktree is its own repository. A dev server registers its root and its origin and gets routes under `/blueline/<app>/`. The server accepts a page request only from a registered origin, with CORS for the script tag; the Vite proxy keeps requests same-origin. Tests: two repositories, two dev servers for one repository, a script tag from its own origin.                                                                                                                                                                                                                                                                                                              | A3, W0         | `bin/serve.ts`, `src/io`                        |
| B2    | Ways in: the Vite plugin (the script tag and a proxy to the server, which it starts), a script tag by hand, `blueline dev -- <cmd>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | B1             | `src/vite.ts`, `bin/dev.ts`                     |
| C1    | `blueline mcp`: `wait_for_feedback`, `reply` and `apply`, on the W0 contract, so it does not wait for B1. The tools and their words never change, for the prompt cache. Test: a line that an agent pulled is not delivered again by a wake.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | W0, D0         | `bin/mcp.ts`, `src/mcp`                         |
| C2    | Hooks, `blueline setup <harness>` and the wake adapters. Proves four cases before the launchd service retires: an agent in a turn gets a note at its next tool call, an idle agent wakes, with no agent a new one starts, an agent that thinks for minutes between hooks stays busy, and an agent killed in a turn is gone at once and its lines go to a wake.                                                                                                                                                                                                                                                                                                                                                                                                                           | C1, B1         | `src/deliver`, the dotfiles service             |
| D1    | `blueline.config.ts`: journeys as data. A step has `enter`, `setup`, `ready` and `exit`; a variant has `show`. Before each variant, Blueline runs the step's `reset`, then `setup`, then the variant's `show`, then waits for `ready`. A step that does not get ready in time shows why on its row. The actions are `open`, `click`, `type`, `press`, `wait` and `emit`; a step can also hold an async function. The server bundles the config and reloads it on change.                                                                                                                                                                                                                                                                                                                 | A2, B1         | `src/config`                                    |
| E1    | The dev dashboard on the package: the Vite plugin in place of its aliases and React island, its journeys in `blueline.config.ts`. Before it starts, a table maps each helper in the dashboard's adapter to a config action, to its `dash:review` handler, or to an async function it keeps. Merge after the other session's edits land.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | A5, B2, C2, D1 | the dashboard repository                        |

The slices land in this order, one at a time: W0, A1, A2, A3, A4, B1, B2, D1, A5, E1.
C1 runs beside them in its own worktree once W0 lands, and C2 lands after C1 and B1. The React app at work and Next.js (steps 6 and 7)
come after E1.

### A3 in steps

A3 lands in five commits. Each one passes `pnpm run verify` and works on the demo and the
dashboard. Browser checks start with step 2.

1. **The overlay's root.** `src/core/root.ts` holds the roots that Blueline's own nodes are
   in: the document, and the shadow roots that steps 2 and 3 add and take out with their
   hosts. `own(selector)` and `ownAll(selector)` look in each. `focused()` follows `activeElement` through shadow roots.
   `targetOf(event)` takes a DOM event or a React event, and gives the node the event
   started at (`composedPath()[0]`, on React's `nativeEvent`). Every query for a `data-dt-*`
   node, and every `activeElement` and `event.target` check in `src/ui`, `src/keys`,
   `src/vim` and `src/part/lift.tsx`, uses them. A focus listener such as `TreeFocus`'s
   `focusout` listens on the roots as well as the document: a move of focus inside a shadow
   root sends the document no event. A query for the page's targets, a pin's selector or a
   step's `target`, still looks in the document. A point over the overlay's host is
   Blueline's, not the page's.
2. **A shadow root and its CSS.** `mount` and `DevTools` render the tools, but not yet the
   lift, into `host.attachShadow({ mode: "open" })`. A script compiles `src/styles.css`
   with Tailwind's standalone entry, and writes `src/ui/overlay-css.gen.ts`, a string the
   shadow root adopts; Tailwind does not scan the generated file. Verify fails when the
   file is not current. The script makes three changes to the CSS:
   - Each `rem` becomes `px` at 16 px, so the page's root font size does not resize the
     tools.
   - Each `@property` rule becomes a declaration in the `properties` layer, the lowest, on
     `*, ::before, ::after, ::backdrop`, with `initial` where the rule has no initial
     value. A browser ignores `@property` in a shadow root, and Tailwind's shadows, rings
     and transforms need the initial values. A declaration outside the layer would win over
     the utilities.
   - The theme's variables, the resets (`all: initial`) and the tools' font go on the
     tools' own root elements, not on `:root` or `:host`.
     Blueline's own toasts replace sonner, which writes its CSS into the page's head when it
     loads. The app still imports `styles.css` for the lift until step 3.
3. **The lift on slots.** The lift gets its own host on the page. Its stage, its lines and
   its bar are in the host's shadow root. Each preview is a light child of the host, with
   `slot="<axis>/<variant>/<state>"`: the row and the column both show the part where they
   cross, and a slot name fills one slot only. The page's CSS styles each preview, and it
   keeps the part's props and React context. The stage's `<slot>` stands where `render(o)`
   stands today, so the previews move with the lines and nothing measures them. A slotted
   preview inherits from its slot, so the elements between the host and each slot set no
   inherited property: the theme and the resets stay on the chrome's own elements, and a
   preview inherits from the page, as it does today from `body`. The lift's shadow root is
   one of the tools' roots while the lift is up, so a query finds its note's composer, and
   the focus comes back to that composer. One React still renders
   both halves, through two portals. The app stops importing `styles.css`.
4. **The bundle.** Two entries, and one store between them:
   - The part store and the registry are small modules with no Effect and no React. Each
     keeps its state on a global key (`Symbol.for`) that names its protocol version, so
     every copy of the module, from source or from any bundle, shares one store and one
     registry. A copy that finds another version there warns once and keeps its own state.
     Tests load two copies: one notifies and unsubscribes the other's listeners, and one
     replaces the other while a lift is up.
   - One overlay owns the page. `mount` and `DevTools` claim it through a global key; the
     newest claim disposes the one before, whichever entry made it. Tests mount in both
     orders.
   - `@henrikkvamme/blueline` is the overlay for an app of any framework: `mount`, the
     types and the routes. It bundles its own React, React DOM, Effect, XState and lucide,
     and needs no peer.
   - `@henrikkvamme/blueline/react` is for a React app: `DevTools`, `useReviewControl`,
     `useDevTools`, `useRegistry` and `variants()`. It runs the overlay on the app's React,
     so the app's hooks and the tools' share one dispatcher; `react` and `react-dom` are its
     peers. From source, Blueline's Vite plugin dedupes `react`, `react-dom` and the JSX
     runtimes, so Blueline's own install of React does not load beside the app's; a test
     checks it with two installs. `./choices` and `./variants` stay as parts of it. `variants()` imports only the
     store, so an app's build, which shows the first variant, holds none of the overlay.
     The lift's data goes through the store: the part puts its labels, states, place and
     callbacks there when it rises; the overlay draws the lift's chrome from them and puts the
     options it shows, and the lift's host, back; `variants()` draws only the slotted copies.
     `effect` and `tailwindcss` stop being peers. `effect` is a dependency, as the command
     needs it; `react`, `react-dom` and `tailwindcss` are optional peers. Only the workshop,
     which draws in the app's own CSS, needs `tailwindcss`, for `./styles.css`. An adapter may still return an Effect of the
     same effect version; any other version gives a Promise. The dashboard moves in the same
     step. It is not a React app, so it calls `mount` from the main entry: its island needs
     no React root and no CSS for Blueline. Its key guard (`entry.ts`) knows
     `[data-blueline-host]`. Step 4 is done when the dashboard works
     on it.
5. **Browser tests.** Vitest browser mode with Playwright's Chromium runs the demo's
   adapter in a real shadow root, both from source and from the packed package. The tests
   type in the composer, walk the tree with keys, open and choose in a menu, and lift a
   part, go through its variants on both lines and put one on the page.

### A4 in steps

A part is a place on the page, marked `data-blueline-part="<name>"`, and the code that draws
it. An app of any framework gives that code to `part`, from the main entry and as
`window.blueline.part`:

```ts
const rows = part("Request rows", {
  variants: ["Table", "Cards"], // the first is the one the app ships
  states: ["Empty"],
  // Draws a copy of the part into `into`: the variant, in a state or the page's own, of the
  // part whose element on the page is `source`. Returns what takes it out again.
  show: (into, { variant, state, source }) => mountRows(into, rowsOf(source), variant, state),
});
// The app draws the marked element on the page from what the reviewer shows.
rows.subscribe(() => render(rows.shown())); // shown(): { variant, state }
rows.dispose();
```

Each framework can start a view in a given element: Elm's `init({ node })`, Vue's `mount`,
Svelte's `mount`, Solid's `render`, Lit's `render`, React's `createRoot`. So `show` is the
contract for the lift's copies. Its cleanup stops what the view started, as its
subscriptions: Elm has no call that stops a program, so an Elm app's `show` keeps a way to
stop its copy. Copies that an app draws inside its own one tree would need
a host the app gives; that waits until an app needs it (To verify).

1. **The core part.** `src/part/part.ts`, with no React. `part` declares the part's
   variants, states and `show` in the shared store. One MutationObserver, shared by every
   copy of Blueline on the page, finds each element marked with a declared name, except in
   a Blueline host (`[data-blueline-host]`) and in an element that a registered instance
   already holds. Each element is an instance in the store, as a React part is. An element
   that leaves the page, checked once its mutations are done, ends its instance, so a move
   keeps it. The app draws the element on the page; Blueline never changes it. While the
   part is lifted, Blueline keeps one copy for each slot of the lift's stage: a light child
   of the lift's host with the slot's name, filled by `show` with the instance's element as
   `source`. When a slot's variant or resolved state changes, the copy's cleanup runs and
   `show` draws it again; a slot that goes is cleaned up and removed. Every copy is cleaned
   up when the part lands, when its instance ends, when the page's owner changes, and on
   `dispose`.
2. **Parts in markup.** A part with no code, for static HTML. Blueline owns the element's
   content: the app does not change it.

   ```html
   <div data-blueline-part="Request rows" data-blueline-variant="Table">
     <table>
       …
     </table>
     <!-- Table, as it is -->
     <template data-blueline-state="Empty">…</template>
     <!-- Table, Empty -->
     <template data-blueline-variant="Cards">…</template>
     <!-- Cards, as it is -->
     <template data-blueline-variant="Cards" data-blueline-state="Empty">…</template>
   </div>
   ```

   The element's `data-blueline-variant` names its own content, the first variant; it is
   needed once a template names another. The variants are that label, then each template's
   label in order; the states are the templates' state names in order. A template with no
   variant is the first variant's. A variant with no template for a state shows that
   variant as it is. `show` clones the template; on the page, Blueline moves the element's
   own content aside while another variant or a state shows, and puts it back after.

3. **React on the same store.** `variants()` keeps drawing its copies with portals, so
   each copy keeps the app's props and React context. Its element is registered by its
   layout effect before the observer runs, so the observer skips it. The store itself
   takes no instance whose element is in a Blueline host, so a part nested in a lifted
   part's copy is not one, whichever way it registers.
4. **Tests.** Browser tests on a page with no React and no Tailwind:
   - a code part with two instances of different content: `v` lifts one, and each slot's
     copy shows that instance's content in its variant and state, also after moves on both
     lines; Enter puts the variant on the page through `subscribe`;
   - a markup part: its base content, a named state, and a missing combination, on the
     page and in the lift; going back to the base puts the page's content back;
   - a marked part inside a copy, and in a Blueline host, is not an instance, and lifting a
     React part with a nested `variants()` part adds no instance; an element
     moved in the page keeps its instance; one removed ends it and its copies;
   - a part declared by one copy of the module and found by the other's observer;
   - `dispose`, landing and an owner change clean up every copy.

   The demo's React tests also check the copies' content after moves on both lines.
   `blueline apply` for a part outside `variants()` stays open (To verify).

### B1 in steps

`blueline serve` keeps every repository's channel on the machine. B1 builds the server and
its rules; the page still talks to its dev server until B2 puts the Vite plugin's proxy and
the script tag in front of it.

1. **The channel as one handler.** The four routes the Vite plugin serves now, `feedback`,
   `images`, `status` and `listening`, move into one Node request handler for one app's
   files, with the same rules: a note is JSON from the page or from a tool, gets its ID
   and version (`stamped`), and is appended; an image is at most 20 MB of a known type. The
   plugin uses the handler until B2. It stays plain Node, with `.ts` imports, as Node loads
   the plugin's source directly.
2. **One server for each machine.** `blueline serve` listens on `127.0.0.1` on one known
   port, 4399, or `BLUELINE_PORT`. `GET /blueline/health` says it is Blueline, with its
   version and process ID. A second `serve` that finds the port taken asks it: if Blueline
   answers, it says so and exits 0; anything else is an error that names the port. Node's
   `http` serves; Effect runs the command and closes the server on a signal.
3. **Registration.** A dev server sends `POST /blueline/register` with its root, its
   origin, its process ID and, if it has them, its files. A request from a browser, one
   with an `Origin`, cannot register. The server finds the repository: the real path of
   `git rev-parse --show-toplevel` from the root, so a worktree is its own repository. An
   app is one root: the same root again is the same app, with one more origin, as two dev
   servers for one repository; another root in the same repository is another app. The
   app's name is the repository's folder name, then the root's path inside it, in
   lowercase with hyphens, and a number when another repository took it. The answer gives
   the app's name, its base `/blueline/<app>/` and its files, by default in
   `<root>/.blueline/`. The server keeps the apps in memory. A dev server's registration
   ends when its process no longer runs, checked on each request; no timer ends it.
4. **Routes and origins.** `/blueline/<app>/<route>` runs the channel handler on the app's
   files. A request with an `Origin` must come from one of the app's registered origins:
   then the answer allows that origin (CORS, `Vary: Origin`), and an `OPTIONS` preflight
   for a JSON or image `POST` is answered. Any other origin gets 403, and an unknown app 404. A request with no `Origin`, from the agent's tools, is served as now.
5. **Tests.** In Node, on a server started in the test on a free port: two repositories
   get two apps with their own files; two dev servers for one root are one app with two
   origins, and a third origin gets 403; a root inside a repository gets the name with its
   path; a preflight and a `POST` from a registered origin get the CORS headers; a browser
   cannot register; a registration ends once its process is gone; a second `serve` finds
   the first. The plugin's channel tests still pass on the handler.

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

- Whether a claim needs an acknowledgement. `blueline listen` claims a line when it prints
  it, so a watcher whose reader died takes lines that no agent sees; on 2026-10-26 a
  listener left by an expired Monitor took a note this way. The MCP pull and the hooks
  return lines inside the agent's turn, so they may not need one; C2 decides.
- Whether still copies of a step's target (requirement 2) look right on the dev dashboard,
  whose styles come from the page and not from the part.

- T3's MCP steer for an outside process: the public docs do not show it yet.
- Whether an outside process can reach a running Codex TUI through the app-server.
- Whether an app that draws one tree, as Elm or Foldkit, wants its lift copies in that tree,
  with a host the app gives, instead of a view started by `show`.
- How `blueline apply` treats a part that is marked with `data-blueline-part` and not a
  `variants()` call.
