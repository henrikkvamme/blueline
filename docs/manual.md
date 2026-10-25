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

- Parts: the **bar** at the bottom centre, full on a step and small at other times; the
  **sidebar** on the right; the **step card** beside the lit part, and the **light** around
  that part; the **message field** at the bottom of a card; a **pin**, the numbered mark of
  Alt+click, and its **note card**; the **page card**, off a step; the **lift** (`v`);
  the **preview** (Ctrl+P).
- Words: a **review** walks a **journey** of **steps** in **groups**; an **open step** is
  not settled yet, and **settle** (`y`) says a step is right as it shows. A **part** has
  **variants**. Each step and each page has one **chat** with the agent. A **note** is
  written on a pin and waits; a **message** is written in a message field and sends, with
  the notes in it. A sent note leaves the page; its message shows it with its number. The
  agent's answer is a **reply**, in the chat. `?` lists the **keys**.

## Where you are

There is no mode to go into or out of. What you open in the sidebar is where you are: a
step opens it, with its card and the full bar, and a page leaves the step for the page,
with its card and the small bar. Escape on a step leaves it for the page too. The walk stays
where it was, so the journey's row opens it again on the same step.

When the last open step settles, the review ends by itself. The tools go back to the page,
a short message says the journey is done, and the journey's row in the sidebar shows a
check. `u` takes the last settle back and opens its step again. A journey with every step
settled opens all its steps again from its row, or from `g j`, for another pass; a step's
row opens that one step and keeps the journey settled.

On a step, the card's switch says whose chat you write in: **Step** or **Page**. A click
or Tab switches it, also in the message field, so you write on the page and keep your
place in the journey. Alt+click writes its note in the same chat.

## The g menu

`g` opens a small menu above the bar, as LazyVim's which-key, from the page and the sidebar.
The key after `g` does the thing, and any other key closes the menu: `g j` picks a journey, `g p` picks from this page's chat, notes and parts, and `g a`
acts as someone. As in vim, `g g` and `G` go to the top and the bottom: on the page, the
first and the last open step; in the sidebar, the top and the bottom row. `?` lists them
with the other keys.

## On a phone

Each key has a button, and the bar's `?` lists the keys and does each one with a tap. On a
screen narrower than 640 px, the bar takes the screen's width and stands above the page's
own bottom bar. The cards stand above the bar as sheets, and the chevron folds the step
card. A swipe to the left or the right across the lit part shows the next or the previous
variant. On the lift, a swipe across goes through the variants, and a swipe up or down goes
through the states. The pin in the message field points at an element for a note, as
Alt+click does. A tap in a field starts to write.

## Moving between the page, a field and the sidebar

Enter in a message field sends, and in a note keeps the note; then the keys are the page's,
so `y` or `i` comes next. Escape in a field goes to vim's normal mode, and a second Escape
goes to the sidebar and opens it, so you see where you are; in the lift's note it leaves the
field. While the sidebar is open, it has the keys when no field has them.

Escape backs out one level at a time, from the page and the sidebar: it closes what is open
over the page, then leaves the step for the page, then closes the page's card, then hides
the tools.

The sidebar is a tree, as Neovim's: this page and the pages with notes, in the order of
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

Ctrl+B goes into the sidebar from a field, and from the sidebar hides it; `i` there goes
back to the field you left, at its place, to write. The panel that has the keys has a thin
ring.
Ctrl+P is the **preview**, on a step and off one: it hides the tools, the sidebar too, and leaves
only an eye that shows them again. Escape in the sidebar off a step does the same, so the
sidebar and the note card come back together; Ctrl+B closes the sidebar. A second Ctrl+P or `i` shows
them with the sidebar as it was, and comes back to the field, in its mode and at its place;
Escape and Ctrl+B show them with the keys in the sidebar, and `i` there goes back to the field.
In the preview the keys turn as the sidebar has them: `j` and `k` go to the step after and
before, and `h` and `l` show the step's variants one by one, to compare them with the page
alone. Off the preview, `h` and `l` go over the steps, and `j` and `k` over the variants.
Ctrl+H and Ctrl+L show the previous and the next variant, in the preview and off it. An app
with its own `h`, `j`, `k` and `l` takes those keys first, and leaves these to the tools.

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
step, also from the sidebar or the card's button; `y` on a settled step opens it again and
keeps none. The last open step settled ends the review, as "Where you are" says. The bar says
how many variants the step has, and a tab on the light's edge shows which one the page
shows, a dot for each; on a step with none, `v` says so.

A variant is a way the part could look; a state is what it could show. Give a part's
states as patches in `variants`, so the lift draws them side by side. A step's own
`variants` set up data on the page through `apply`, one at a time: the bar and `v` call
them the step's states. A settle keeps the one shown too: the settle line names it in
`variant`, and its `keep` tells the agent to make it the app's own, as it has no
`variants` call for `blueline apply` to change.

Off the lift, the keys mean the same: `i` writes a note on the step, and `R` opens the
next reply, or goes through the notes on the page when no reply is new.

## Notes on a page

Off a step, the tools are a chat with the agent on the page. `i` opens the page's card,
and Alt+click writes a note on an element. A note waits: the bar counts the ones not sent,
and the next message takes them all, in it. Enter in an empty message field sends the
notes alone. The agent reads them in the journey `page`, on the step `place:<path>`, and
answers in the card. `blueline review` listens to it.

A note line has the chat's `id`, and `pins`: each note in the message, with what it points
at and its words. A pointed note has no ID of its own, so the agent answers the message and
its notes with `blueline reply` on the chat's `id`. `/clear` empties the chat, and its
old messages go.

Each page has its own notes, by its path. An app whose router keeps the page out of the
address's path, as in its hash, gives `DevTools` the page's `path`, and a `navigate` that
goes to a path, so the sidebar's pages go there.

## Review a page

A page with `variants` parts needs no journey. The sidebar's "This page" lists a step for
each part the page shows, and an app with no journeys starts there from the sidebar. A step
opens nothing: it lights its part, `v` lifts it, and `y` keeps the variant shown and goes on
to the next open step, from the page or the sidebar. The agent reads the journey `page`; a
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
applies the kept variants. A listener that starts again still has the settles it held.
