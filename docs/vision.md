# Vision: Henrik only judges

Status: a draft from a talk with Henrik on 2026-10-30. This is not agreed design. The words
in **bold** that are not in [GLOSSARY.md](../GLOSSARY.md) are proposals.

## Why

Agents now build most of the code well, most of all in an Effect or Rust stack with strong
static checks. So the human's best use is taste: look at the UI, pick between options, and
say what is wrong. Each other task that the human does is a cost: remembering worktrees, dev
servers, threads, branches and tickets. In the future the human does less technical work
and never more.

**The goal:** Henrik's work is only to look, pick and say. Blueline does everything that can
be automated. When Blueline must choose, it chooses, shows its choice and makes a change of
that choice cheap. It does not ask first.

**The measures:** the time from a note to a reply that he can review, the number of times he
must act per journey, and the number of things that he must remember. That last number
should be zero.

## The model

Today the unit is a repository root: each worktree is its own app with its own review. The
vision needs larger units. The journey becomes the unit of work, so Blueline needs no
separate word for a change.

| Word             | What it is                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project**      | One product. It has one repository, or a group of repositories, and many places.                                                                    |
| **Place**        | One URL where a project runs: a worktree's dev server, hosted dev, staging or prod. Each place shows one commit or branch, if Blueline can know it. |
| Journey          | One unit of work and its review: a branch, its worktree, its agent, its remarks and its brief.                                                      |
| **Orchestrator** | The project's one agent that Henrik talks to. It routes each note to a journey and hands parallel work to journey agents.                           |
| **Inbox**        | One list of what waits for Henrik, for all projects: journeys that are ready, replies, and questions.                                               |

The life of a journey: **working**, then **ready** (it waits for Henrik), then settled
(Finish), then merged, then **archived**. T3 Code does the same with its threads. Blueline
reads merged and archived from git, so a journey that is on main and whose branch merged is
archived. No one edits the config to archive it.

### Each note goes to a journey

A note is never kept on a page alone. Henrik can still write a note on any page; Blueline
gives it a journey.

**Where Henrik is does not decide where a note goes.** He does not need to be on the right
remark, in the right journey or on the right worktree's dev server. The place and the remark
that show are only hints. The **orchestrator** (see Routing) decides from what the note is
about.

1. Henrik writes a note on any place, with any remark showing, or with none.
2. The orchestrator reads the note's words, its pins, the page, the commit of the place, and
   the open journeys with what their branches changed. It gives the note to the journey
   that works on the same thing, or it starts a new journey: a branch, a worktree and a
   brief from the note.
3. Rules take the clear cases first, with no model, so they are fast:
   - a pin on an element that one open journey's branch changed goes to that journey;
   - an answer in an annotation's replies stays with that annotation.
4. The annotation stays on its pin, and the pin keeps the page's path, so the agent and
   Henrik find it again from any place of the journey.
5. The note shows where it went at once, as a chip such as "→ Header spacing (new)". One
   click moves it to another journey. Henrik does not choose first, and he can ignore the
   chip.
6. When the journey is ready, the inbox tells him. One click opens the journey's place on
   its first remark. If the dev server does not run, Blueline starts it.

What this makes simpler:

- One unit for Henrik, the agents, the inbox and the orchestrator. One Finish and one hand-off per
  unit of work.
- The page review (This page) stops being a journey. The page becomes only a surface to
  write on. A part with variants comes from a journey's branch, so it is a remark of that
  journey. On main, every part has one variant, because its verdict was applied.
- Each annotation has its own replies. Notes no longer wait in a page's chat.

What it costs:

- A one-line note on main makes a journey with one annotation, a branch and a worktree. That is
  correct when Blueline makes it, and wrong if Henrik must. So it must be automatic.
- The glossary's journey changes from "one flow" to "one unit of work". Step and group
  leave the glossary.

### The tree

This is the answer to the problem that started this talk: the tree showed old journeys as
open in each worktree.

- The tree shows the place's own journey first and open.
- The other open journeys of the project show below it, with their state (working or
  ready). A row opens the journey's own place: the "switch worktree".
- Settled journeys show at the foot under Settled, until they are archived.
- Archived journeys do not show. Search finds them, and a walk of one is a regression pass.

### One project, all its places

Feedback on any place is feedback on the project. The agent gets the place's commit, and
can compare it with main and with the journey's branch. Each note already holds the pin's selector,
the element's text and screenshots, so a note on prod is still exact.

The map from place to project is kept in two locations:

- `blueline.config.ts` gives the project's places, such as `places: ["https://dev.example.com"]`.
  This is the record, under version control.
- `blueline serve` keeps a registry on the machine that it builds from the configs that it
  knows, and from the dev servers that register. The extension asks this registry.

When a site is not known, the panel says so. It offers "Find its repository": an agent looks
for the domain in the local clones and on GitHub, and then proposes to add the place to the
config. When no repository matches, Blueline can only keep notes. A user script for a site
that Henrik does not own is out of scope for now.

## Annotations are the conversation

Henrik talks to Blueline through annotations on the UI, not through a chat.

- **The agent annotates too.** When it changes the page, it pins an annotation on what it
  changed: "Moved the total under the table; check that it still reads as the sum." Its pins
  have another colour. Henrik reads the result where it is, not in a stream of text.
- **An annotation has its own replies**, as a comment in Figma does. A question and its
  answer stay on the element that they are about. Each annotation is open or resolved.
- **An annotation can hold blocks**, the same generative UI as a reply today: variants, a
  before and after, a question with answers to click.
- **The chat becomes the transcript**: the raw stream to and from the orchestrator. It
  is there to look into when something is wrong, and it feeds the UX measures. Henrik does
  not need to read it.
- **An annotation whose element is gone** shows in the journey's list as detached, with its
  screenshot, and does not vanish. The pin finds its element again by its selector, then
  its text.

### Settle without a key

Agreed in principle with Henrik on 2026-10-30: Blueline settles for him, and each settle can
be undone. The rule is one sentence: **what Henrik saw and did not object to is settled.**

- When the agent fixes an annotation, the annotation shows **fixed, check**. It is not
  resolved yet.
- When Henrik shows a remark and goes on with no new annotation, Blueline settles the
  remark and resolves the annotations that it answers. A short toast says "Settled", with
  `u` to undo.
- A remark that he never showed does not settle. So each remark still needs one look.
- Settle stays as a key, for a remark that he wants to settle at once. Back can still open
  a remark again.
- Finish works the same way: when every remark of the journey is settled, the journey is
  ready to finish, and the inbox shows one button.

### The brief

The words are proposals until the glossary takes them: **brief** for a journey's living
generative UI, and **transcript** for the raw stream to and from the orchestrator. The
transcript replaces the chat, so the glossary's Chat goes when it lands.

Each journey has a brief in place of the steps' walls of text: a piece of generative UI that says what
the feature is, what to look at and what to try. The agent writes it and keeps it current.

- The agent **changes the brief in place** after each piece of feedback and each change of
  the page. It does not add to it. Henrik reads what is true now, not what happened.
- **What changed since he last looked** has a mark, and the old versions are one click away.
- The brief **refers to remarks and annotations** by their numbers. A click on "see 3" shows that pin.
- The brief is made of named blocks, as an OpenUI Lang program is made of named statements
  (`header = Stack(...)`). So the agent can replace one block by its name and keep the rest.

### The format

Blueline's blocks follow OpenUI's component library, as JSON that an Effect schema checks
(`src/notes/blocks.ts`). OpenUI Lang is about half the tokens of JSON and draws while it
streams. But Blueline's agents write blocks through a tool call, whose input is JSON in any
case, so that gain is small. Blueline takes two ideas from OpenUI and keeps its JSON:

- each block gets a stable `id`, so one block can be replaced;
- words can refer to an annotation or a remark, such as `@annotation(3)`, as OpenUI's `@`
  functions do.

## Next: one key for what needs Henrik

The default control is **Next**, and **Back** goes the same order in reverse. Henrik does
not choose what to look at. Blueline keeps one **queue** of what needs him, and Next takes
the first item.

An item is a remark: something new to look at, an answer to his annotation, a choice
between variants, or a question.

The order keeps his context and keeps little work open at a time:

1. **Finish where he is.** The remarks on the page and the area that show come first.
2. **Finish before starting.** Remarks that answer his earlier annotations come next, the
   oldest first.
3. **Then new remarks**, but only while fewer than a limit of his annotations wait on the
   agent. The limit starts at 2; the prototype finds the right number.
4. When the limit is reached and nothing has come back, the queue says so: "2 annotations
   wait on the agent, about 40 s". It never shows a remark he cannot act on.

A remark that comes back while he looks at another one does not move him. The queue counts
it, and Next takes him there when it is its turn.

**Each item stands alone**, so a return to an earlier place costs little: it shows what he
wrote, what the agent changed, a before and after, and the one thing to decide. The agent
points at the place on the page. One key gives the usual answer: good, another annotation,
or a variant by its number.

### Fewer things to look at

- **Only what needs a human.** A change that a check can prove, such as a test or a still
  that is the same as before, does not go into the queue. Small, safe fixes come as one
  item: a grid of before and after stills, settled with one key.
- **A fast first answer.** A fast model answers an annotation in about a second: it says
  what it understood, and it can show a preview on the page, a change of CSS or words only.
  The journey's agent then does the real change. Henrik corrects a wrong understanding at
  once, not a minute later.
- **Ready before he arrives.** While he looks at one remark, Blueline makes the next remark's
  stills and variants, so Next is instant.
- **The size of the session.** The queue shows how much is left: "6 items, about 4 min".
- **One line to come back.** After a break, the first item says where he was and what came
  back.

### Remarks replace steps

Agreed with Henrik on 2026-10-30. A journey has no steps. It has the agent's **remarks**,
as many as it needs, and Henrik's annotations. Both are pinned on the page and both have
replies.

- A **remark** is what the agent asks Henrik to look at, or its answer to an annotation. It
  can carry setup (where to go and what to click), variants and a ready check, as a step
  does today.
- A settled remark leaves the queue. Back still goes to it, in the same order.
- A journey of 28 steps where 25 are settled is now a queue of 3 remarks. Henrik never walks
  past finished work.

### Decided on 2026-10-30

- **Remarks are written at run time.** Agents write remarks through the CLI or MCP, and
  Blueline keeps them for each journey. Setup is plain actions as data: open, click, type,
  wait. `blueline.config.ts` keeps only shared helpers, such as "sign in as a reviewer", that
  remarks call by name. Nothing piles up on main.
- **The last settle ships the journey.** When every remark of a journey is settled, that is
  Henrik's approval. The journey's agent runs the ship flow: checks, review, merge gate,
  merge. The inbox shows it, and Henrik can stop it for a short time.
- **One queue for each project.** Next stays in the project that shows, so the context stays
  small. The inbox shows the other projects, and Henrik switches on purpose.
- **Break, and migrate both apps.** One minor version removes steps and the journeys in the
  config. zug-web and the dev dashboard move to remarks in the same release.

### The agent points

The agent shows where it means, as [Clicky](https://heyclicky.com) does: a cursor of its own
moves to the element, a frame draws around it, and a caption says the words. A remark can
play this as a walk of a few seconds, and any key stops it. A still screen and words stay
the default, so nothing moves without a reason.

## Routing and threads

Anthropic's Applied AI team published a guide on 2026-10-22: fold routers, planners and
domain subagents into one agent loop, with skills and context that it loads when it needs
them. In their deployments, one loop often gave better quality at less cost and latency. A
handoff loses context. They keep subagents only for work in parallel that needs a fresh
context, for verification, and for separate permissions. Their 2025 research system used
about 15 times the tokens of a chat with many agents.

For Blueline, that gives these rules:

- **No separate router.** Rules route the clear cases. The orchestrator routes the rest, and
  it can do a small journey itself.
- **One agent for each journey** plans and implements it in one loop, with no planner or
  separate implementer. Journeys are true work in parallel, each in its own worktree, so
  one agent each is the case where separate agents pay off.
- **One orchestrator per project** routes each note that the rules cannot place. It looks at
  the open journeys and the project memory, and either gives the note to a journey or
  starts one. It can do a small journey itself instead of starting another agent. It is the first mate in
  [firstmate](https://github.com/kunchenguid/firstmate), but with less to do.
- **The orchestrator does the work itself first.** It starts a journey agent in its own
  worktree only for work in parallel: a second journey while one is in progress. At most 3
  journey agents run at once for each project, and more work waits.
- **A ready gate before Henrik.** A remark enters his queue only after its agent opened it in
  a browser, saw it get ready and took a still. A remark that fails is fixed first.
- **Verification can be a separate agent**, as a review of a diff before a journey is
  ready.
- Context across journeys goes in a **project memory** file, not in one long thread. It
  holds the places, the conventions and Henrik's verdicts. Each agent reads it.

The orchestrator and the journey agents run behind an adapter, as delivery does now
(ADR 0005): a T3 thread, a firstmate home or a Claude Code session.

## The browser extension

An extension lets Henrik make notes on any place, with no change to the app. That is the
"note anywhere" goal. ADR 0004 rejected an extension, because it adds a store review and a
second way to mount the overlay. The vision changes those facts. The extension is the only
way in for hosted dev and prod, and it can be unlisted or self-hosted. So it needs a new
ADR. The wrapper command and the Vite plugin stay for local dev servers.

## Know how the UX is

Blueline already logs each line, delivery, reply and step time (0.1.16). The next step is to
use these logs automatically:

- **Agent speed:** the time from a note to its claim, and to its reply, as p50 and p90.
- **Page speed:** the time until a page loads and until a remark is ready, and the remarks
  that fail to get ready.
- **Henrik's cost:** the time from a reply to his next act, and the number of acts per
  journey.
- **Reply quality:** a take back, a note sent again or a "no" after a reply is a signal. A
  judge model scores a sample of replies against their notes. One key gives a thumbs up or
  down on a reply.
- **A weekly digest** goes to the inbox, and an alert goes when a p90 gets worse.

## Prototypes

The interface is decided by prototypes that Henrik can use, not in a chat. Each one has an
agent from a script, with a set delay, so it runs in seconds and shows the same thing each
time. They can live in the workshop (`src/workshop`).

1. **The queue.** Next and Back over a fake journey, remarks that come back after a set
   delay, and the limit of open annotations as a setting. It answers the order and the limit.
2. **Remarks on the page.** The agent's remarks pinned beside Henrik's annotations, the brief
   in the panel, and a reference from the brief to a pin. It answers how a remark and an annotation look side by side.
3. **The agent points.** Its cursor, frame and caption, still and as a walk. It answers if
   motion helps or distracts.
4. **The fast first answer.** The same annotation with a fast answer and a preview, and with
   only a wait. It answers if the preview is worth its cost.
5. **Talk and point.**
6. **The blocks.** Every generative UI block in each of its states: empty, long, streaming,
   with an error, on a phone. This is its own workshop, as there are many.

Each workshop shows each state of what it tests side by side, not only the happy path. Hold a key, speak and click. It answers if voice is faster than typing
for Henrik.

## Ideas

- **Taste memory.** Each verdict says what Henrik kept and deleted. Blueline collects these
  into a short file of his preferences, such as "dense tables, no cards", and gives it to
  each agent. The agent's first variant is then more often right.
- **Variants by default.** A visual note gets two or three variants unless the change is
  trivial. Picking is faster than describing.
- **References.** Henrik drops a screenshot or a URL on a note: "like this". Each project
  keeps a board of references, which agents use.
- **A ready gate.** A journey is ready only when its dev server runs, each of its remarks gets
  ready and its checks pass. Henrik never sees a broken state.
- **Before and after.** A journey's review can show main and the journey's branch side by side, as the
  lift does for variants.
- **Review in a batch.** The inbox puts ready journeys in order, so Henrik reviews five in a
  row with the keys only.
- **Close the loop.** After a merge, the inbox gives the prod place where the journey is
  live, so Henrik can check it there if he wants to.
- **Voice notes**, and review on the phone through Tailscale.

### From Clicky

[Clicky](https://heyclicky.com) is an AI on the screen that sees, talks and points. Its
release on 2026-10-23 added drawing on the screen, one brain that remembers across days and
gives large work to agents, a Chrome extension for agents, and captions while it speaks.
Ideas from it:

- **Talk and point.** Henrik holds a key and speaks, and clicks the elements while he
  speaks. Blueline writes one annotation for each click, with the words that he said at
  that moment. This is faster than typing.
- **The agent points back.** The agent draws on the page, a box or an arrow, to show what it
  means, and speaks or captions it. A journey's brief can play as a short walk-through.
- **A fast answer for a quick question.** "Why is this grey?" gets an answer from a fast
  model that reads the code, with no change and no worktree. A real change goes to the
  journey's agent. Clicky routes its voice the same way.
- **Ask, do not guess**, but only where the answer changes the result. Elsewhere, choose and
  show.
- **The agent drives the browser.** Through the extension, the agent opens the page, walks
  its own journey and checks it before it says that a journey is ready.
- **A quick peek.** The launcher shows how many things wait in the inbox, and a hover shows
  them.
- **Mark as unread**, and **stop after three failures**, for the inbox and the ready gate.

## Robustness

- Effect 4.1.0 came out on 2026-10-29. Blueline uses 4.0.6. Upgrade it, as the project rule
  asks for the latest stable release.
- [Rat Stack](https://ratstack.sh) has one typed contract that serves the CLI, HTTP, MCP and
  browser RPC. Blueline has all four surfaces. One Effect `HttpApi` or `Rpc` schema for the
  channel would make a broken contract a compile error.
- **XState 6: decided on 2026-10-30.** Henrik chose to move to XState 6 while it is in
  alpha (6.0.0-alpha.66 on 2026-10-14). It has a smaller API, schemas through Standard
  Schema (so Effect Schema works), and actors from an Effect (`fromEffect`). The project rule
  in `CLAUDE.md` changes to allow it, an ADR records it, and the version is pinned exactly,
  as the API can change between alphas.

## Order

1. The tree shows the place's journey, with other journeys' state and archive from git.
   This is small and fixes the clutter now.
2. Project and place: `places` in the config, the registry in `serve`, and one review across
   the worktrees of one project.
3. Know how the UX is: the measures, the digest and the judge.
4. Remarks replace steps, and each note goes to a journey through the orchestrator.
5. The extension, with its ADR.
6. The home and the inbox for all projects, which find projects by themselves.

## Open questions

- One orchestrator per project, or one for all projects? The transcript is then one per
  project.

- Does a note on prod start a journey by itself, or wait in the inbox for one click?
- Is one day after merge the right time to archive?
