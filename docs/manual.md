# Blueline

`@henrikkvamme/blueline` is the review walk over an app in development: journeys of steps, notes to
the agent, and parts with variants. A build holds none of it.

## Set up in an app

The app needs React 19.3 or later, Tailwind 4.3 or later and effect 4.0.6, the
package's peers. Four places use it:

- The styles, after Tailwind: `@import "@henrikkvamme/blueline/styles.css";`. Tailwind finds the
  tools' classes from there.
- The dev server's channel to the agent, in `vite.config.ts`:
  `devtoolsChannel({ feedback, status })` from `@henrikkvamme/blueline/vite`.
- `<DevTools adapter={...} storageKey="<app>.review" />`, in a module that the app loads in
  development only. The adapter (`DevAdapter` in `src/types.ts`) gives the journeys and
  opens a step's world.
- `variants` from `@henrikkvamme/blueline/variants` on each part with more than one design.

The agent's command is `blueline`. `examples/review-demo` is a small app set up this way, with
one journey over two pages and one part with variants; `pnpm run demo` starts it on port 4310.

This setup is the one the code has now. [design.md](design.md) gives the setup that
replaces it: `blueline dev`, a Vite plugin or a script tag, and no peers.

## Names

The tools, their hints and these docs use one name for each thing. The workshop's Names
tab shows each part on a map of the screen.

- Parts: the **panel** on the right, with the **tree** of pages and journeys, the step and
  the chat; the **message field** at the bottom of the panel; the **bar** at the bottom
  centre, the panel's folded form, full on a step and small at other times; the **light**
  around the step's part; a **pin**, the numbered mark of Alt+click, and its **note card**;
  the **lift** (`v`); the **preview** (Ctrl+P).
- Words: a **review** walks a **journey** of **steps** in **groups**; an **open step** is
  not settled yet, and **settle** (`y` or Enter) says a step is right as it shows; **finish** ends the review once every step is settled. A **part** has
  **variants**. Each step and each page has one **chat** with the agent. A **note** is
  written on a pin and waits; a **message** is written in a message field and sends, with
  the notes in it. A sent note leaves the page; its message shows it with its number. The
  agent's answer is a **reply**, in the chat. `?` lists the **keys**.

## Where you are

There is no mode to go into or out of. What you open in the tree is where you are: a step
opens it, and a page leaves the step for the page. Escape on a step leaves it for the page
too. The walk stays where it was, so the journey's row opens it again on the same step.

## The panel

The panel stands at the right, and the page narrows by its width, so the panel covers
nothing. Its top line holds the journey's title, the journey's progress, **More** and the
button that hides the panel. The title unfolds the tree. The progress has a dot for each
step: green when settled, grey when open, and a wider blue pill for the step shown. More holds
Reset the step, Hide the tools, Undo and the keys (`?`).

On a step, the step fills the rest of the panel. A faint line gives the step's number and
group. Under it are the step's title, what to look at and what to try. When the step has
more than one variant, the **Variants** list shows them as rows, with **Lift** at its right.
The raised row is the variant that the page shows. A click on a row shows that variant, as
`h` and `l` do. Then comes the step's chat, which scrolls, and the message field. At the
foot are the step before, **Settle** and the step after. The foot stays in one place from
step to step. A click on a variant row, Lift, an arrow or Settle leaves the focus where it
was, so Enter settles next. Off a step, the panel shows the tree and the page's chat.

The button at the panel's top right and Ctrl+B hide the panel, and show it again. Hiding
changes only the view: the walk stays on its step, and the light stays on the part. The
hidden panel folds to the bar: on a step it shows the step's number and title, the step
before and after, and Settle; off a step it is small. The bar and the panel never show at
once, and a reload keeps the panel shown or hidden. An element that the app pins to the
right edge can still sit under the panel.

| Action                       | The walk                          | Light                       | Panel                                                  |
| ---------------------------- | --------------------------------- | --------------------------- | ------------------------------------------------------ |
| Ctrl+B or the panel's button | stays on the step                 | stays                       | hides or shows                                         |
| Ctrl+P                       | stays on the step                 | hides                       | hides, and only the eye shows                          |
| Esc, with no field focused   | leaves the step for the page view | off                         | shows the page's chat                                  |
| A settle                     | goes on to the next open step     | turns green, then glides on | shows the next step; the step's row gets its check     |
| The last settle              | waits on the step                 | turns green, and stays      | shows the finish                                       |
| Finish review                | ends: the journey is done         | off                         | shows the page's chat; the journey goes to **Settled** |

## Settle

A settle shows that it took. The light turns green and a check draws in its corner, for
about 400 ms. Then the step's row in the tree gets its check, and the walk goes on to the
next open step. The light waits while the page scrolls to the next part, glides there in
about 300 ms and pulses once, so you see where to look next. On another page it fades out,
and in on the new part. A settled step keeps its green light and its check, so a walk back
to it shows that it is settled.

`u` runs the motion backwards: the light comes back to the step green, and turns blue as
its check draws out. With reduced motion, the light does not glide or pulse: it fades, the
colour changes, and the check only fades.

While a settle's motion plays, and until the next step shows with its light in place,
another `y`, Enter or check does nothing, so a held or quick key never settles a step you
have not seen.

When the last open step settles, the review does not end at once. The panel shows the
finish in place of the step: how many steps are settled, the variant kept of each part, and
how many notes went to the agent. **Finish review**, or Enter, ends the review: the tools go
back to the page, a short message says the journey is done, and the journey goes down to
**Settled**. The back arrow, where the step before was, Escape or `u` opens the last step
again. The Enter that settled the
last step does not also finish: Finish takes only an Enter pressed after the finish shows.
A reload keeps the finish. Each change of a step's settled state, undo and redo too, writes
the step's settle line, so the agent always knows which steps are settled.

After Finish, `u` takes the last settle back and opens its step again. The tree keeps the
open journeys on top, and the journeys with every step settled at its foot, folded, under
**Settled**; a journey that moves between the two comes in with a short motion. A journey
with every step settled opens all its steps again from its row, or from `g j`, for another
pass; a step's row opens that one step and keeps the journey settled.

On a step, the chat is the step's. Once the page's chat has messages, a quiet button at the
chat's top opens it, so you write on the page and keep your place in the journey; **Back to
the step** returns. Tab in the message field switches too, also before the page's chat has
messages. Alt+click writes its note in the chat that shows.

## The g menu

`g` opens a small menu at the bottom centre, as LazyVim's which-key, from the page and the
tree.
The key after `g` does the thing, and any other key closes the menu: `g j` picks a journey, `g p` picks from this page's chat, notes and parts, and `g a`
acts as someone. As in vim, `g g` and `G` go to the top and the bottom: on the page, the
first and the last open step; in the tree, the top and the bottom row. `?` lists them
with the other keys.

## On a phone

Each key has a button, and the `?` lists the keys and does each one with a tap. On a
screen narrower than 640 px, the panel is a sheet at the bottom, above the page's own bottom
bar, and its tree stays folded until you tap its line. Hidden, it folds to the bar, which
takes the screen's width in the same place. The note card stands above the bar as a sheet.
A swipe to the left or the right across the lit part shows the next or the previous
variant, as `l` and `h` do. The step arrows in the sheet and the bar go to the step before
and after. Settle, between the arrows in the sheet's foot and a check in the bar, settles: the light turns green above the sheet, as on a wide
screen. When the sheet would cover the light's corner, the page scrolls the part up once.
Every button there is at least 44 px. On the lift, a swipe across goes through the variants, and a swipe up or down goes
through the states. The pin in the message field points at an element for a note, as
Alt+click does. A tap in a field starts to write.

## Moving between the page, a field and the tree

Enter in a message field sends, and in a note keeps the note; then the keys are the page's,
so `y` or `i` comes next. Escape in a field goes to vim's normal mode, and a second Escape
goes to the tree and unfolds it, so you see where you are; in the lift's note it leaves the
field. While the tree shows, it has the keys when no field has them. On a step it folds, and
the page has the keys, so `j` and `k` walk the steps.

Escape backs out one level at a time, from the page and the tree: it closes what is open
over the page, then leaves the step for the page, then hides the tools.

The tree is as Neovim's: this page and the pages with notes, in the order of
their paths, and the journeys. A page's row is its chat: it shows the chat's last words, and
opens the chat. A page opens on its notes not sent, and this page on its parts too; a
journey opens on its steps, and a step on its notes not sent. This page and the journey
walked start open, and the tree keeps what you open and close. A sent note leaves the tree;
its message in the chat has it.

- `j` and `k` go over every row. The pointer selects the row it is on.
- `l` opens the row, then goes down into it; on a row with nothing under it, `l` opens what
  the row names. `h` closes the row, or goes up to the row it is under and closes that; at
  the top, it goes up one row.
- Enter does what a click on the row does, and opens the row too: a page goes to that page
  and opens its chat, a journey starts, a step opens on its page, and a note opens where it
  is.
- `y` settles the selected step and goes on to the next open step, as on the page. The
  page's other keys, as `v`, work as on the page too.
- On a step, a click on the folded line unfolds the tree, and so does a key of the tree's
  while the line has the keys. A step opened from it folds it again.

`i` in the tree goes back to the field you left, at its place, to write. The panel has a
thin ring while it has the keys.

Ctrl+B hides the panel and shows it again, from a field too. A field in the panel that had
the keys gets them back when the panel shows again, in its mode and at its place.

Ctrl+P is the **preview**, on a step and off one: it hides the tools, the panel too, and
leaves only an eye that shows them again. Escape in the tree off a step does the same, so
the panel and the note card come back together. A second Ctrl+P, Escape or `i` shows them
with the panel as it was, and comes back to the field, in its mode and at its place; Ctrl+B
shows them with the panel shown. The keys do not change in the preview.

## The keys of a walk

One rule holds on the page, in the lift and in the tree: across is the variant, down is the
step.

| Key            | Where                 | What it does                                        |
| -------------- | --------------------- | --------------------------------------------------- |
| `j`, `k`       | the page              | the step after, the step before                     |
| `h`, `l`       | the page              | the previous, the next variant, on a step with more |
| `J`, `K`       | the page              | the open step after, before: not settled            |
| Ctrl+J, Ctrl+K | the page              | the step after, before, as `j` and `k`              |
| Ctrl+H, Ctrl+L | the page and the tree | the previous, the next variant, as `h` and `l`      |
| `y`, Enter     | the page              | settle the step, then go on to the next open step   |
| `j`, `k`       | the tree              | the row below, above                                |
| `h`, `l`       | the tree              | close the row or go up, open it or go down into it  |
| Ctrl+J, Ctrl+K | the tree              | the open step below, above                          |
| Enter          | the tree              | open the selected row                               |

An app with its own `h`, `j`, `k` and `l` takes those keys first, and leaves the Ctrl keys
to the tools. Enter settles only while no control of the app has the focus: on the app's
button, link or field, Enter is the app's, so a press still clicks it. A button of the
tools' that a click left the focus on does not take Enter; one that Tab went to does. A
held `y` or Enter settles once: its repeats do nothing.

## Variants of a part

Wrap a part that has more than one design in `variants`. The result is the part's
component, and the page uses it as before:

```tsx
import { variants } from "@henrikkvamme/blueline/variants";

export const SuggestionView = variants<SuggestionProps>(
  "Suggestion",
  {
    "Card under the field": (p) => <SuggestionCard {...p} />,
    "Tracked change": (p) => <TrackedChange {...p} />,
  },
  {
    Accepted: { suggestion: { state: "accepted" } },
  },
);
```

- The first variant is the one a build ships.
- A state is a patch over the props: only what differs. A plain object merges into the
  prop's object; anything else takes the prop's place.
- Give each part one name. Two parts with the same name are one design choice.
- A review step finds the part in its `target`. When the target holds more than one part,
  name it with the step's `part`.

On the step, `v` lifts the part: variants in a row, states in a column. `Enter` puts the
variant shown on the page, `d` deletes one, `u` undoes, `i` writes a note on the variant
shown, and `R` goes to the next variant with a note. Settling the step with `y` keeps the
variant the page shows, sends the step's notes not sent yet, and goes on to the next open
step, also from the tree or the Settle button; `y` on a settled step opens it again and
keeps none. The last open step settled asks you to finish the review, as "Settle" says. The
panel lists the variants as rows, and a click on a row shows that one. The bar says how many
variants the step has, and a tab on the light's edge shows which one the page shows, a dot
for each; on a step with none, `v` says so.

A variant is a way the part could look; a state is what it could show. Give a part's
states as patches in `variants`, so the lift draws them side by side. A step's own
`variants` set up data on the page through `apply`, one at a time: the bar and `v` call
them the step's states. A settle keeps the one shown too: the settle line names it in
`variant`, and its `keep` tells the agent to make it the app's own, as it has no
`variants` call for `blueline apply` to change.

Off the lift, the keys mean the same: `i` writes a note on the step, and `R` opens the
next reply, or goes through the notes on the page when no reply is new.

## Notes on a page

Off a step, the panel is a chat with the agent on the page. `i` goes to its message field,
and Alt+click writes a note on an element. A note waits: the bar counts the ones not sent,
and the next message takes them all, in it. Enter in an empty message field sends the
notes alone. The agent reads them in the journey `page`, on the step `place:<path>`, and
answers in the panel's chat. `blueline review` listens to it.

A note line has the chat's `id`, and `pins`: each note in the message, with what it points
at and its words. A pointed note has no ID of its own, so the agent answers the message and
its notes with `blueline reply` on the chat's `id`. `/clear` empties the chat, and its
old messages go.

Each page has its own notes, by its path. An app whose router keeps the page out of the
address's path, as in its hash, gives `DevTools` the page's `path`, and a `navigate` that
goes to a path, so the tree's pages go there.

## Review a page

A page with `variants` parts needs no journey. The tree's row for this page lists a step for
each part the page shows, and an app with no journeys starts there from the tree. A step
opens nothing: it lights its part, `v` lifts it, and `y` keeps the variant shown and goes on
to the next open step, from the page or the tree. The agent reads the journey `page`; a
step's id is `page:<part>`, and its group is the page's path. Write a journey only for a
flow across people or pages.

## Apply the reviewer's verdicts

The settle line and the reviewer's next note carry `parts`, the variant kept and the ones
deleted per part, and an
`apply` hint:

```sh
blueline apply <feedback.jsonl> --part <name> [--keep <variant>] [--src <dir>]
```

- With one variant kept, the call becomes that variant, typed from the call. The import
  and the steps' `part` fields go too.
- Otherwise the deleted variants leave the call.
- With none kept, name one with `--keep`. Read the notes for which one.

## The agent channel

Start a review with `blueline review`, under a watcher such as Claude Code's Monitor:

```sh
blueline review <feedback.jsonl> --url <page> [--journey <id>] [--step <id>]
```

It checks that the app answers at the page, prints the link to send the reviewer, and then
listens. The link opens the review on the page: the page's own with no `--journey`, or
that journey at `--step`. `blueline listen` only listens, and `blueline reply` answers
a note. Run `blueline` alone for the usage.

While the agent works, it shows its progress in place, as a `plan` block:

```sh
blueline reply <status.json> <note id> working --blocks <plan.json>
```

The plan shows under "The agent is on it" in the note's chat. Each working reply puts its
blocks in place of the last, so the plan changes as the agent goes on; a working reply with
no `--blocks` takes the plan away. The agent's reply ends it: the plan leaves the chat, and
the reply shows.

A settle does not wake the agent. The listener holds it and prints it, tagged `status`,
with the next note, so the agent reads where the review is without a turn of its own. The
last settle, which leaves no step open, wakes the agent: the review is done, and the agent
applies the kept variants. The tools send that settle only when the reviewer finishes the
review, so the agent wakes once, at the end. A listener that starts again still has the settles it held.
