# Blueline

`@henrikkvamme/blueline` is the review walk over an app in development: journeys of steps, messages
and annotations to the agent, and parts with variants. A build holds none of it.

## Set up in an app

`@henrikkvamme/blueline` holds its own React, so an app of any framework can use it. A React
app can use `@henrikkvamme/blueline/react` instead, which runs on the app's React 19.3 or
later. The app needs no CSS for Blueline: the tools and the lift stand in shadow roots with
their own CSS. Three places use it:

- The dev server's channel to the agent, in `vite.config.ts`: `devtoolsChannel()` from
  `@henrikkvamme/blueline/vite`. It starts `blueline serve` when none runs, registers the
  app, and puts the page's own review on each page; an app that mounts its own tools sets
  `overlay: false`. The notes go to `.blueline/` in the app's root, or to the `feedback` and
  `status` files it gives. In middleware mode, give the page's `origin`. When the app links
  Blueline from its source, the plugin also has Blueline's files use the app's React. An app
  with no Vite uses `blueline dev` (see "With no change to the app") or a script tag by
  hand (see "One server for the machine").
- `mount({ adapter, storageKey: "<app>.review" })`, in a module that the app loads in
  development only, or `<DevTools adapter={...} storageKey="<app>.review" />` from
  `@henrikkvamme/blueline/react` in a React app. The adapter (`DevAdapter` in `src/types.ts`) gives the journeys and opens a step's
  world. Its code for a step gives a value, a Promise or an Effect. It gets an
  `AbortSignal`, which aborts when the walk goes on without it; a result after that is
  dropped. `mount` gives a handle, which is also `window.blueline`: `start(journey, step?)`
  starts a review, `moved()` says that the app went to another page in a way the tools do
  not see, and `dispose()` takes the tools off. A page has one overlay: the newest `mount`
  or `<DevTools>` takes the one before off, and a lifted part lands. `useReviewControl()`
  starts a review on the overlay that has the page, or on the next one to start.
- `variants` from `@henrikkvamme/blueline/variants` on each part with more than one design.
- Or no adapter code: the journeys as data, in `blueline.config.ts` in the app's root (see
  "Journeys in a config").

The agent's command is `blueline`. `examples/review-demo` is a small app set up this way, with
one journey over two pages and one part with variants; `pnpm run demo` starts it on port 4310.

### With no change to the app

`blueline dev -- <command>`, in the app's root, runs the app's own dev command and puts the
page's own review on each page, with no change to the app's code:

```sh
blueline dev -- pnpm dev
```

The page stays on the port it had, so its origin does not change. `blueline dev` holds that
port with a proxy, and the dev server listens on another one, which it does not see: it
still names the page's port in its lines and its request URLs. The proxy sends every request
and websocket on, and adds the overlay's script tag to each HTML page, also a compressed or
streamed one. It finds the page's port for Vite (`vite`, `vp dev`) and Next.js (`next dev`),
also through a package script: from the command's `--port`, from `PORT` for Next.js, from
Vite's config, or the dev server's default. For another dev server on Node, name the port:
`blueline dev --port 4000 -- <command>`. `--host` names where the proxy listens. When
`blueline dev` stops, by Ctrl+C or a signal, it stops every process that the command
started, and exits with the command's code.

It does not work for an HTTPS dev server, a dev server that is not on Node, or a command
that sets `NODE_OPTIONS` itself; set `NODE_OPTIONS` in the environment instead. Use the Vite
plugin or a tag by hand there. The page loads the app's `blueline.config.ts` as a tag by hand
does, so the config may import only `@henrikkvamme/blueline/config`.

### An app with its own keys

An app with its own keyboard shortcuts needs no code for Blueline. On a step, Blueline takes
each key it binds before the app sees it, so the app's handler for `h` or Enter does not run.
Off a step, the app gets its keys first. A key in the app's field, select or slider is the
app's, but Ctrl+B on a step, and so are Enter, Space and the arrows on the app's button, link or other control. A
key that Blueline does not bind always goes to the app. [The keys of a walk](#the-keys-of-a-walk)
gives the whole rule.

Blueline's tools stand in a shadow root on a `<blueline-tools data-blueline-host>` element. A
key or click in the tools reaches the app's own listeners with that element as its target, so
an app that ignores Blueline's events checks `target.closest("[data-blueline-host]")`.

An app that wants to know what the walk does reads `data-blueline` on
`document.documentElement`. It is the one supported way to know. Do not read Blueline's
saved review in `localStorage`: its format can change.

| `data-blueline` | While                                              |
| --------------- | -------------------------------------------------- |
| `step`          | a step is open                                     |
| `finish`        | every step is settled and the panel asks to finish |
| `handoff`       | the panel shows a hand-off, opened from its row    |
| `lift`          | a part is lifted                                   |
| `preview`       | the tools are hidden, on a step or off one         |
| no attribute    | Blueline is idle, or shows the page with the tree  |

The `DevWalk` type names the values. A CSS rule can use it too, as
`:root[data-blueline="step"] .shortcut-hint { display: none; }`.

## Journeys in a config

An app can give its journeys as data, with no adapter code. `blueline.config.ts` (or
`.js`) in the app's root gives them, and the page's own review gets them: through the Vite
plugin, or through a tag by hand.

```ts
import { defineConfig } from "@henrikkvamme/blueline/config";

export default defineConfig({
  journeys: [
    {
      id: "request",
      title: "Handle a request",
      steps: [
        {
          id: "inbox",
          title: "The inbox",
          look: "Each request shows its sender and its age.",
          group: "Manager",
          enter: [{ open: "/inbox" }],
          setup: [{ click: "#filters" }],
          reset: [{ press: "Escape", on: "#filters" }],
          ready: ["#inbox [data-row]"],
          target: ["#inbox"],
          variants: [{ label: "Dense", show: [{ click: "#dense" }] }, { label: "Roomy" }],
        },
      ],
    },
  ],
});
```

- A step has what a `DevStep` has, with `group` as one string, its ID and its title.
- `enter` opens the step's world; `setup` opens its part, again before each variant;
  `reset` takes a variant's state off; `exit` runs when the walk leaves the step, after
  `reset`. Each is a list of actions or a function that gets an `AbortSignal`.
- `ready` is the selectors that show the step is ready, or a function.
- `timeout` is how many milliseconds each of these may take: 5000 by default. A phase that
  fails or is too late stops the phases after it. The step's mark on the bar and its row,
  and its words in the panel, say why in red, until the step opens again.
- A variant has a `label`, unique in its step, and a `choice` (`[name, option]`) or `show`.

The actions:

| Action                                            | What it does                                                                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ open: path }`                                  | Goes to the path with a new page load, unless the page is there. Only the first action of `enter`.                                                                         |
| `{ click: selector }`                             | Clicks the element.                                                                                                                                                        |
| `{ type: text, into: selector }`                  | Focuses the field and sets its value as typing does, so React and other frameworks see it.                                                                                 |
| `{ press: key, on?, shift?, ctrl?, alt?, meta? }` | Sends the key down and up to the element, or to the focused one. Enter on a field in a form submits it, unless a handler stopped it. Blueline's own keys do not act on it. |
| `{ wait: selector }`                              | Waits for the element.                                                                                                                                                     |
| `{ emit: name, detail? }`                         | Sends a window `CustomEvent`.                                                                                                                                              |

Each action that names an element waits for it first. When an action loads a new page, as a
click on a link does, the step goes on on the new page at the next action. A reload opens the
step again from its start.

Journey IDs are unique, and step IDs are unique across all journeys: notes, verdicts and
variants are kept by them, and the review keeps its step and variant when the config
changes. `page`, and IDs that start with `page:` or `place:`, are the page review's. A config
that breaks a rule is not used: the tree says why in place of the journeys, and so does the
console.

A change to the config loads the page again, on the same step. Through the Vite plugin the
config may import the app's code. A tag by hand loads it from `blueline serve`, which takes
its types off; it may import only `@henrikkvamme/blueline/config`.

## Names

The tools, their hints and these docs use one name for each thing. The workshop's Names
tab shows each part on a map of the screen.

- Parts: the **panel** on the right, with the **tree** of pages and journeys, the step and
  the chat; the **message field** at the bottom of the panel; the **bar** at the bottom
  centre, the panel's folded form, in a review; the faint **launcher** in the corner while
  the tools are **idle**; the **light**
  around the step's part; a **pin**, the numbered mark of `m` or Alt+click, and its **annotation
  card**; the **lift** (`v` or Space); the **preview** (`p`).
- Words: a **review** walks a **journey** of **steps** in **groups**; an **open step** is
  not settled yet, and **settle** (`y` or Enter) says a step is right as it shows; **finish** ends the review once every step is settled. A **part** has
  **variants**. Each step and each page has one **chat** with the agent. An **annotation** is
  written on a pin and sends with Enter; a **message** is written in a message field and
  sends, with the annotations that joined it. A sent annotation leaves the page; its message shows it with its number. The
  agent's answer is a **reply**, in the chat. `?` lists the **keys**.

## Where you are

Off a review, the tools are idle: the panel is hidden, a faint launcher sits in the bottom
right corner, and every key but Ctrl+B is the app's. Alt+click annotates the page at any
time; the annotation goes to the page's chat, and the card closes when it is sent. The
launcher, Ctrl+B or a review link from the agent opens the panel. A page loads idle unless a
review was open.

There is no mode to go into or out of. What you open in the tree is where you are: a step
opens it, and a page leaves the step for the page. Escape on a step leaves it for the page
too. The walk stays where it was, so the journey's row opens it again on the same step.

## The panel

The panel stands at the right, and the page narrows by its width, so the panel covers
nothing. Its top line holds the journey's title, the journey's progress, **More** and the
button that hides the panel. The title unfolds the tree. The progress has a dot for each
step: green when settled, grey when open, and a wider blue pill for the step shown. A journey of
more than 10 steps has a thin bar in place of the dots: the settled share is green, the step's
place is blue, and the step's number stands beside it, as "3 of 14". More holds
Reset the step, Next reply, Hide the tools, Undo and the keys (`?`). Next reply is grey when
no reply is new.

On a step, the step fills the rest of the panel. A faint line gives the step's number and
group. Under it are the step's title, what to look at and what to try. When the step has
more than one variant, the **Variants** list shows them as rows, with **Lift** at its right.
The raised row is the variant that the page shows. A click on a row shows that variant, as
`j` and `k` do. Then comes the step's chat, which scrolls, and the message field. The field
is one row while your words fit on one line. When they wrap, the words take the whole width
and the buttons move to a row under them. At the
foot are the step before, **Settle** and the step after, as a left and a right chevron. On a
step that lists variants, Settle names the variant that it keeps, as **Keep Cards**, and the
name changes with the variant shown. A settled step's button reads **Kept Cards**, or
**Settled** with no variants, in green, and a press goes on. A small green check in the list
marks the kept variant. When you show another variant on a settled step, the button turns
blue and reads **Keep Table**. The button keeps its width: a long name ends in an ellipsis. The foot stays in one place from
step to step. A click on a variant row, Lift, a chevron or Settle leaves the focus where it
was, so Enter settles next. Off a step, the panel shows the tree and, past one quiet line,
the page's chat. The message field's words name the chat: "A message on this page" or "A
message on this step".

The button at the panel's top right and Ctrl+B hide the panel, and show it again. Hiding
changes only the view: the walk stays on its step, and the light stays on the part. The
hidden panel folds to the bar: on a step it shows the step's number and title, the step
before and after, and Settle; off a step it is small. The bar and the panel never show at
once, and a reload keeps the panel shown or hidden. An element that the app pins to the
right edge can still sit under the panel.

| Action                       | The walk                          | Light                       | Panel                                              |
| ---------------------------- | --------------------------------- | --------------------------- | -------------------------------------------------- |
| Ctrl+B or the panel's button | stays on the step                 | stays                       | hides or shows                                     |
| `p`, or Hide the tools       | stays on the step                 | hides                       | hides, and only the eye shows                      |
| Esc, with no field focused   | leaves the step for the page view | off                         | shows the page's chat                              |
| A settle                     | goes on to the next open step     | turns green, then glides on | shows the next step; the step's row gets its check |
| The last settle              | waits on the step                 | turns green, and stays      | shows the finish                                   |
| Finish review                | ends: the journey is done         | off                         | shows the tree; the journey goes to **Settled**    |

## Settle

A settle goes on at once: the panel shows the next open step, and the step's row in the
tree gets its check. The next open step is the first open one after the step you settled.
With none after it, it is the journey's first open step. At the same time, the part you settled shows that the settle took: its
outline turns green and a check draws in at its corner, then both fade. The light glides
from that part to the next one and pulses once, so you see where to look next. The whole
motion takes about 250 ms. On another page the light fades out, and in on the new part. A
settled step keeps its green light and its check, so a walk back to it shows that it is
settled.

`u` runs the motion backwards: the light comes back to the step green, and turns blue as
its check draws out. With reduced motion, nothing glides or pulses: the green outline and
the check only fade, and the light fades in on the new part.

Until the next step shows with its light in place, another `y`, Enter or check does
nothing, so a held or quick key never settles a step you have not seen.

Settle always means "this is right, go on". A walk back to a settled step shows its kept
variant, and the button is green. Enter there goes on to the next open step and writes
nothing. To change your mind, show another variant: the button turns blue, as **Keep
Table**. Enter keeps Table in place of the old variant, writes one settle line, plays the
green motion and goes on. The old variant is kept no more, and it is not deleted. `u` takes
the change back. To open a settled step again, press `u` right after the settle, or choose
**Open the step again** in the panel's ⋯ menu. In the tree, `y` on a settled step opens it
again too.

When the last open step settles, the review does not end at once. The panel shows the
finish in place of the step: how many steps are settled, the variant kept of each part, and
how many messages and annotations went to the agent. **Finish review**, or Enter, ends the review: the light goes
off, the panel goes back to the page and the tree, and the journey goes down to **Settled**.
The tree has the keys, on the journey's row, so Enter there opens its hand-off. The back chevron, where the step before was, Escape or `u` opens the last step
again. The Enter that settled the
last step does not also finish: Finish takes only an Enter pressed after the finish shows.
A reload keeps the finish. Each change of a step's settled state or kept variant, undo and
redo too, writes the step's settle line, so the agent always knows which steps are settled
and what they keep. The last settle waits for Finish, so until then its step counts as open
in each line.

The finished journey's row says what the agent does with the review, in a short line under
its title: "Sent", then "Working" with the item of the plan that the agent is on, then
"Replied" with the first line of the reply, or "Taken back". A mark beside it shows the same,
and a blue dot shows a new reply. A click on the row, or Enter on it in the tree, opens the
**hand-off**. It says "Sent to the agent" over the same rows as the finish. Under them you
see what the agent does with the review, in place: a pulsing dot while it waits for the
agent, then "The agent is working" with the agent's plan, then the agent's reply. **Take
back** tells the agent to ignore the review, and **Done**, Escape or the journey's title at
the top goes back to the tree. A reload keeps the hand-off. The row keeps its line while the
agent works on the review, or its reply is new. After Done on a reply, the row starts another
pass again. A reply that comes while the hand-off is not in view shows a short message that
opens it, and **Next reply** in More goes there too. Nothing opens by itself.

After Finish, `u` takes the last settle back and opens its step again. The tree keeps the
open journeys on top, and the journeys with every step settled at its foot, folded, under
**Settled**; a journey that moves between the two comes in with a short motion. A journey
with every step settled opens all its steps again from its row, or from `g j`, for another
pass; a step's row opens that one step and keeps the journey settled.

On a step, the chat is the step's. Once the page's chat has messages, a quiet button at the
chat's top opens it, so you write on the page and keep your place in the journey; **Back to
the step** returns. Tab in the message field switches too, also before the page's chat has
messages. Alt+click writes its annotation in the chat that shows.

## The g menu

`g` opens a small menu at the bottom centre, as LazyVim's which-key, from the page and the
tree.
The key after `g` does the thing, and any other key closes the menu: `g j` picks a journey, `g p` picks from this page's chat, annotations and parts, and `g a`
acts as someone. As in vim, `g g` and `G` go to the top and the bottom: on the page, the
first and the last open step; in the tree, the top and the bottom row. `?` lists them
with the other keys.

## On a phone

Each key has a button, and the `?` lists the keys and does each one with a tap. On a
screen narrower than 640 px, the panel is a sheet at the bottom, above the page's own bottom
bar, and its tree stays folded until you tap its line. Hidden, it folds to the bar, which
takes the screen's width in the same place. The annotation card stands above the bar as a sheet.
A swipe to the left or the right across the lit part shows the next or the previous
variant, as `j` and `k` do. The chevrons in the sheet and the bar go to the step before
and after. Settle, between the chevrons in the sheet's foot and a check in the bar, settles: the light turns green above the sheet, as on a wide
screen. When the sheet would cover the light's corner, the page scrolls the part up once.
Every button there is at least 44 px. On the lift, a swipe across goes through the variants, and a swipe up or down goes
through the states. **Annotate**, the pin beside send in the message field, points at an element, as
Alt+click does. A tap in a field starts to write.

## Moving between the page, a field and the tree

Enter in a message field sends, and in an annotation sends the annotation; then the keys are the page's,
so `y` or `i` comes next. Escape in a field goes to vim's normal mode, and a second Escape
goes to the tree and unfolds it, so you see where you are; in the lift's annotation it leaves the
field. While the tree shows, it has the keys when no field has them. On a step it folds, and
the page has the keys, so `h` and `l` walk the steps.

Escape backs out one level at a time, from the page and the tree: it closes what is open
over the page, then leaves the step for the page, then hides the tools.

The tree is as Neovim's: this page and the pages with annotations, in the order of
their paths, and the journeys. A page's row is its chat: it shows the chat's last words, and
opens the chat. A page opens on its annotations not sent, a journey on its steps, and a step on
its annotations not sent. The journeys start with **This page**, the page's own review, and the
settled journeys come last. This page and the journey walked start open, and the tree keeps what you open and close. A sent annotation leaves the tree;
its message in the chat has it.

- `j` and `k` go over every row. The pointer selects the row it is on.
- `l` opens the row, then goes down into it; on a row with nothing under it, `l` opens what
  the row names. `h` closes the row, or goes up to the row it is under and closes that; at
  the top, it goes up one row.
- Enter does what a click on the row does, and opens the row too: a page goes to that page
  and opens its chat, a journey starts, a step opens on its page, and an annotation opens where it
  is.
- `y` settles the selected step and goes on to the next open step, as on the page. On a
  settled step it opens the step again. The
  page's other keys, as `v`, `H` and `L`, work as on the page too. The arrows scroll the
  tree.
- On a step, a click on the folded line unfolds the tree, and so does a key of the tree's
  while the line has the keys. A step opened from it folds it again.

`i` in the tree goes back to the field you left, at its place, to write. The panel has a
thin ring while it has the keys.

Ctrl+B hides the panel and shows it again, from a field too. A field in the panel that had
the keys gets them back when the panel shows again, in its mode and at its place.

`p` is the **preview**, on a step and off one: it hides the tools, the panel too, and
leaves only an eye that shows them again. Hide the tools in More does the same, and so does
Escape in the tree off a step, so the panel and the annotation card come back together. A second
`p`, Escape or `i` shows them with the panel as it was, and comes back to the field, in its
mode and at its place; Ctrl+B shows them with the panel shown. Hold `p` to peek: the tools
hide at once and come back when you let go after 200 ms or more. A tap keeps them hidden.
The keys do not change in the preview. After `g`, `p` is this page's chat, annotations and parts.

## The keys of a walk

The keys move the way things stand on the screen. On a step, the panel's foot goes across:
the step before, Settle and the step after. The variants stand in a list down the panel.
Each arrow key does what its vim key does. No key needs AltGr or Option on a Norwegian Mac.

| Key                               | Where    | What it does                                              |
| --------------------------------- | -------- | --------------------------------------------------------- |
| `h`, `l`, ←, →                    | the page | the step before, the step after                           |
| `j`, `k`, ↓, ↑                    | the page | the next, the previous variant, on a step with more       |
| `1` to `9`                        | the page | the variant with that number                              |
| `H`, `L`, Shift+←, Shift+→        | the page | the open step before, after: settled steps are skipped    |
| `g g`, `G`                        | the page | the first, the last open step                             |
| `y`, Enter                        | the page | settle the step, then go on to the next open step         |
| `v`, Space                        | the page | lift the part                                             |
| `i`                               | the page | write a message                                           |
| `m`                               | the page | annotate: a click pins an annotation there; Esc stops     |
| `u`, Ctrl+Z, Cmd+Z                | the page | undo                                                      |
| Ctrl+R, Ctrl+Shift+Z, Cmd+Shift+Z | the page | redo                                                      |
| `p`                               | the page | the preview: a tap hides or shows the tools; held, a peek |
| `j`, `k`                          | the tree | the row below, above                                      |
| `h`, `l`                          | the tree | close the row or go up, open it or go down into it        |
| Ctrl+J, Ctrl+K                    | the tree | the open step below, above                                |
| Enter                             | the tree | open the selected row                                     |

The arrow keys and Space act only on a step, and only while the focus is on the page
itself: on the app's field, select, slider, tabs or another control that uses them, they
are the app's. Off a step, they scroll the page. Enter settles only while no control of the
app has the focus: on the app's button, link or field, Enter is the app's, so a press still
clicks it. A button of the tools' that a click left the focus on does not take Enter; one
that Tab went to does. A held `y` or Enter settles once: its repeats do nothing.

On a step, on the finish, on the hand-off, in the lift and in the preview, these keys are
Blueline's first: the app does not see them. So are the key after `g`, and Escape while `m`
aims. Off a step, the app has its keys first, and Blueline gets a key only when the app
leaves it. Escape on the hand-off leaves it, also in an app that uses Escape itself.

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

On the step, `v` or Space lifts the part: variants in a row, states in a column. `h` and
`l`, or ← and →, go through the variants, and `j` and `k`, or ↓ and ↑, through the states.
`Enter` puts the variant shown on the page, and `v`, Space or Escape closes the lift and
keeps the page as it was. `d` deletes a variant, `u` undoes, `z` zooms, `i` writes an annotation on
the variant shown, and `R` goes to the next variant with an annotation.

The lift's bar under the part gives the part's name, the variant and the state, **Use**,
**Close** and **More** (⋯). Use is blue: it is the one main action. Close does what Escape
does. More holds Delete, Annotate, Next annotation, Undo and Zoom; Next annotation shows only
when a variant has an annotation. Delete asks first. The variant and the state keep their width, so the bar does
not move while you go through them. On a phone the bar has two lines: the name, Use, Close
and More, then the variant and the state. There, a tap on the left half of the variant or
the state goes back, and a tap on the right half goes on.

Settling the step with `y` keeps the
variant the page shows, sends the step's annotations not sent yet, and goes on to the next open
step, also from the tree or the Settle button; `y` on a settled step opens it again and
keeps none. The last open step settled asks you to finish the review, as "Settle" says. The
panel lists the variants as rows, and a click on a row shows that one. The bar says how many
variants the step has, and a tab on the light's edge shows which one the page shows, a dot
for each; on a step with none, `v` says so.

A variant is a way the part could look; a state is what it could show. Give a part's
states as patches in `variants`, so the lift draws them side by side. A step's own
`variants` set up data on the page through `apply`, one at a time. A settle keeps the one
shown too: the settle line names it in `variant`, and its `keep` tells the agent to make it
the app's own, as it has no `variants` call for `blueline apply` to change.

`v` on a step whose own variants change the page, and that has no part, lifts still copies
of its target. Blueline shows each variant on the page in turn, copies the target with its
styles, and then shows the variant the step keeps again; a bar says which variant it copies,
and Escape stops it. The lift then shows the copies in a row. Use puts the chosen variant on
the page, and Close keeps the page as it is. A copy has no Delete and no annotations. Each
variant runs the step's `reset` and `setup` again, as `j` does, so the page loses what you
typed in it. A target of more than 20,000 elements is too big to copy: use `j` and `k`.

Off the lift, the keys mean the same: `i` writes a message on the step, and `R` opens the
next reply, or goes through the annotations on the page when no reply is new.

### A part without React

In an app of another framework, mark the part's place with `data-blueline-part="<name>"`,
and give the code that draws it to `part`, from `@henrikkvamme/blueline` or as
`window.blueline.part`:

```ts
import { part } from "@henrikkvamme/blueline";

const rows = part("Request rows", {
  variants: ["Table", "Cards"],
  states: ["Empty"],
  show: (into, { variant, state, source }) => mountRows(into, rowsOf(source), variant, state),
});
rows.subscribe(() => render(rows.shown()));
```

- The marked element holds the part. The app draws it on the page from `rows.shown()`, and
  draws it again when `subscribe` calls; Blueline does not change it.
- `show` draws a copy for the lift into `into`: the variant, in a state or the page's own
  (`undefined`), of the part whose element on the page is `source`. It returns what takes
  the copy out again, and that also stops what the copy started, as its subscriptions.
- `rows.dispose()` takes the part away.

A part in plain HTML needs no code. Its templates are its variants and its states, and
Blueline draws the element. The element's `data-blueline-variant` names its own content,
the first variant:

```html
<div data-blueline-part="Request rows" data-blueline-variant="Table">
  <table>
    …
  </table>
  <template data-blueline-state="Empty">…</template>
  <template data-blueline-variant="Cards">…</template>
</div>
```

A template with no `data-blueline-variant` is the first variant's. A variant with no
template for a state shows that variant as it is. Blueline puts the element's own content
aside while another variant or a state shows, and back after, so the app must not change
it.

## Annotations on a page

Off a step, the panel is a chat with the agent on the page. `i` goes to its message field,
and `m`, then a click, or Alt+click writes an annotation on an element. **Annotate**, the pin beside send, does
the same. Enter in the annotation's card
sends it at once, as a message with its pin; Shift+Enter starts a new line. To send it
later, press Cmd+Enter, or Ctrl+Enter off a Mac, or click **Later** beside the arrow. The
annotation then waits on its pin, its chip stands over the message field, and it goes with the
next message. While the message field holds words, the annotation joins them: Enter keeps it, its
chip stands over the field, and the message takes it when it sends. The card's button shows
which: a blue arrow sends, and a grey check keeps. Enter in an empty message field sends the annotations that joined
alone. The agent reads them in the journey `page`, on the step `place:<path>`, and
answers in the panel's chat. `blueline review` listens to it. On a page with no journey and
no part with variants, the empty chat says "Alt+click anything to annotate it." until it has
a message or an annotation.

A note line, the wire's name for a message, has the chat's `id`, and `pins`: each annotation
in the message, with what it points at and its words. An annotation has no ID of its own, so
the agent answers the message and its annotations with `blueline reply` on the chat's `id`. `/clear` empties the chat, and its
old messages go.

Each page has its own chat and annotations, by its path. An app whose router keeps the page out of the
address's path, as in its hash, gives `DevTools` the page's `path`, and a `navigate` that
goes to a path, so the tree's pages go there.

## Take back a message

A message goes to the agent at once. To cancel it after it went, use **Take back** under the
message. It shows when the pointer is on the message or the focus is in it, and always on a
phone. It works on each message of a step's chat or the page's, with or without
annotations, and on an annotation sent from its card. Blueline does not stop the agent, as it
can work on other things. It sends one short follow-up in the same chat, which tells the agent
to ignore the message and wait. The message then shows struck through, with **Taken back**,
and the follow-up shows as a small line under it. The agent's reply shows under that line, as
any reply does.

Each message is taken back once: after that, Take back is gone. A follow-up has no Take back.
`u` does not take back a message, as a send is not a change that undo takes back. `u` still
takes back a settle and the other changes it lists. To take back a finished review, see
[Answer the review](#answer-the-review).

## Review a page

A page with `variants` parts needs no journey. The tree lists the journey **This page** first,
with a step for each part that the page shows. It is a journey as any other. A step opens
nothing: it lights its part, `v` lifts it, and `y` keeps the variant shown and goes on to the
next open step, from the page or the tree. After the last step, Finish hands the review off to
the agent. The agent reads the journey `page`; a
step's id is `page:<part>`, and its group is the page's path. Write a journey only for a
flow across people or pages.

## Apply the reviewer's verdicts

The settle line and the reviewer's next message carry `parts`, the variant kept and the ones
deleted per part, and an
`apply` hint:

```sh
blueline apply <feedback.jsonl> --part <name> [--keep <variant>] [--src <dir>]
```

- With one variant kept, the call becomes that variant, typed from the call. The import
  and the steps' `part` fields go too.
- Otherwise the deleted variants leave the call.
- With none kept, name one with `--keep`. Read the messages for which one.

## The agent channel

Start a review with `blueline review`, under a watcher such as Claude Code's Monitor:

```sh
blueline review <feedback.jsonl> --url <page> [--journey <id>] [--step <id>]
```

It checks that the app answers at the page, prints the link to send the reviewer, and then
listens. The link opens the review on the page: the page's own with no `--journey`, or
that journey at `--step`. `blueline listen` only listens, and `blueline reply` answers
a message. Run `blueline` alone for the usage.

While the agent works, it shows its progress in place, as a `plan` block:

```sh
blueline reply <status.json> <note id> working --blocks <plan.json>
```

The plan shows under "The agent is on it" in the message's chat. Each working reply puts its
blocks in place of the last, so the plan changes as the agent goes on; a working reply with
no `--blocks` takes the plan away. The agent's reply ends it: the plan leaves the chat, and
the reply shows.

A settle does not wake the agent. The listener holds it and prints it, tagged `status`,
with the next message, so the agent reads where the review is without a turn of its own. The
last settle, which leaves no step open, wakes the agent: the review is done, and the agent
applies the kept variants. The tools send that settle only when the reviewer finishes the
review, so the agent wakes once, at the end. A listener that starts again still has the settles it held.

### An MCP server for the agent

`blueline mcp` gives an agent the review as MCP tools, on stdio. Add it to the agent's
harness as a server with this command:

```sh
blueline mcp <feedback.jsonl> [--journey <id>] [--as <name>] [--status <status.json>] [--src <dir>] [--wait <seconds>]
```

- `wait_for_feedback` waits for the reviewer's next lines and returns them, tagged as
  `listen` tags them. With nothing new in `--wait` seconds, 50 by default, it returns
  "Nothing new" and the agent calls it again. Set `--wait` below the harness's tool
  timeout less 10 seconds.
- `reply` answers a line on its `id`, as `blueline reply` does, with its blocks as data.
- `apply` applies the verdicts on a part's variants, as `blueline apply` does, to the code
  under `--src`.

Each line goes to one reader: a line that the agent pulled never comes again by a listener or
a wake, and a call that the agent cancels gives its lines back. `--as` names the reader, as
for `listen`. The tools and their words never change, so they stay in the agent's prompt
cache.

### One server for the machine

`blueline serve` keeps every app's channel on the machine, on `127.0.0.1:4399`, or the port in
`BLUELINE_PORT`. The Vite plugin and `blueline add` start it when none runs, as a process of
its own that writes to `serve.log` in its state folder. A second `blueline serve` finds the
first, says so and exits. `blueline serve stop` stops it.

A dev server registers its app's root and its page's origin with `POST /blueline/register`, and the page then reaches the
app's channel under `/blueline/<app>/`. The app's name is its repository's folder and its
path there, such as `shop-apps-web`; a worktree is its own repository. The notes stay in the
app's `.blueline/` folder. A page may use the channel only from an origin that a running dev
server registered; the agent's tools, which send no origin, always may. The server answers
only a request to its own address, so another site cannot reach it by a name of its own. It
keeps its apps in `~/.local/state/blueline/apps.json`, or in `BLUELINE_STATE`.

`blueline dev` registers its page as the plugin does. A page that no dev server registers
loads the overlay by a script tag by hand. In the app's root, keep the page's origin and get the tag:

```sh
blueline add http://localhost:3000
```

It prints the tag to put in the page in development, as
`<script type="module" src="http://127.0.0.1:4399/blueline/<app>/tag.js"></script>`. The origin
stays until `blueline remove http://localhost:3000`. A page cannot keep its own origin.
When the root has `blueline.config.ts`, the tag loads it from the server at
`/blueline/<app>/config.js`, and the page loads again when the file changes.

### Answer the review

The last settle, the one that Finish sends, has an `id` and a `reply` hint. The `id` is the
review's **hand-off**, `finish-<journey>-<time>`, and the panel shows the agent's answer to it
in place of the finish. Answer the review on that ID, not on a step's chat:

```sh
blueline reply <status.json> <hand-off id> working --blocks <plan.json>
blueline reply <status.json> <hand-off id> replied "<what you did>"
```

Write `working` as soon as you start, and again each time the plan changes. End with
`replied`, which says what you did. Answer a message or an annotation on its own chat's `id`,
as before: that answer shows in its step's chat, not in the hand-off. Each Finish has its own
hand-off ID, so an answer to an earlier pass never shows on a new one. **Take back** on the hand-off
tells the agent to ignore the review and its verdicts ([A take-back](#a-take-back)). The
journey stays settled, so the reviewer can settle a step again or start another pass.

### A take-back

When the reviewer takes back a message, the agent gets one more note line in the same chat.
The line is like any message's, and wakes the listener in the same way. It has one more
field, `withdraws`, which names what the agent must ignore:

- a message: `"withdraws": { "id": "<chat id>", "at": <the message's at> }`. The message is the
  one in `thread` with that `at`.
- a finished review: `"withdraws": { "id": "finish-<journey>-<time>" }`. The line's `id` is the
  hand-off, and it has no `step`.

The thread's last entry holds the words. Blueline writes them, not the reviewer, as in:

```text
Take back my message of 14:32 ("Make the button blue"). Ignore it. If you started work on
it, stop. Do not undo the changes you made, unless I ask. Wait for my next message. Reply
to confirm.
```

For a finish, the words name the journey: `Take back my finished review of "Handle a
request". Ignore it and its verdicts.`, then the same last sentences. Do what the words say,
and reply on the line's `id`, as for any message. A reply to a finish's take-back shows in the
hand-off.
