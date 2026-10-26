# Blueline

Blueline is a review of a web app in development by a person and a coding agent. These are
the words that the tool, its docs and its agents use. Each thing has one name.

## The review

**Review**:
One walk over an app in development, by one reviewer, with an agent that answers.
_Avoid_: Session, audit

**Journey**:
An ordered list of steps that follows one flow across pages or people.
_Avoid_: Tour, flow, scenario

**Group**:
A set of steps in a journey that belong together, such as one scenario.
_Avoid_: Section, chapter

**Step**:
One thing in a journey to look at, with what to look for and what to try.
_Avoid_: Stop, item

**Page review**:
The page's own journey, named This page: one step for each part that the page shows. The
tree lists it first under the journeys.
_Avoid_: Ad-hoc review

**Open step**:
A step that the reviewer has not settled.

**Settle**:
The reviewer's statement that a step is right as it shows now.
_Avoid_: Approve, accept, done

**Finish**:
The reviewer's statement that a journey's review is over, once every step is settled. It
sends the last settle to the agent, and the panel shows the hand-off.
_Avoid_: Submit, complete, done

**Hand-off**:
The panel's view after Finish: what the review sent, and what the agent does with it, from a
wait to its plan and then its reply. The agent answers it on the ID of the last settle line.
_Avoid_: Done view, summary

## Parts

**Part**:
A piece of the page that has more than one design.
_Avoid_: Component, widget, slot

**Variant**:
One way that a part could look.
_Avoid_: Option, alternative, design

**State**:
One thing that a part could show, such as empty or accepted.
_Avoid_: Mode, case

**Verdict**:
The variants that the reviewer kept and deleted for one part.
_Avoid_: Decision, choice

## Annotations and chat

**Annotation**:
Words that the reviewer writes on a pin. Enter sends it at once, as a message with its pin.
Cmd+Enter, or Later, keeps it on its pin for the next message. While the chat's message
field holds words, the annotation joins them and goes with that message. **Annotate**, the
pin beside send, starts one. The wire format still says note: a line's `kind: "note"`, its
`pins`, and the chat IDs `note-<step>`.
_Avoid_: Note, comment

**Pin**:
A numbered mark on an element of the page, which an annotation is about.
_Avoid_: Marker, anchor

**Message**:
Words or annotations that the reviewer sends to the agent in a chat. A message sends
at once.
_Avoid_: Post

**Chat**:
The messages and replies of one step or one page.
_Avoid_: Thread, conversation

**Reply**:
The agent's answer in a chat.
_Avoid_: Response, comment

## On the screen

**Panel**:
The one Blueline column at the right of the page. It holds the tree, the step's words, its
variants, the chat and Settle. The page narrows by its width, so it covers nothing. On a phone
it is a sheet at the bottom.
_Avoid_: Sidebar, step card, page card, drawer

**Tree**:
The pages, journeys and steps in the panel. On a step it folds to one line. This page comes
first in the journeys, and the settled journeys stand at its foot, under **Settled**.

**Bar**:
The panel's folded form, at the bottom centre of the page. It shows only while the panel
is hidden.

**Annotation card**:
The card beside a pin, where the reviewer writes the pin's annotation.
_Avoid_: Note card

**Light**:
The frame around the part that a step is about.
_Avoid_: Highlight, spotlight

**Lift**:
The view that shows a part's variants in a row and its states in a column.
_Avoid_: Compare view, grid

**Preview**:
The page with every Blueline control hidden except one eye.

## Agents

**Server**:
The one Blueline process on a machine. It keeps the feedback lines and delivers them to agents.
_Avoid_: Dispatcher, daemon, channel

**Delivery**:
Getting a feedback line to an agent.
_Avoid_: Dispatch, push

**Registered agent**:
An agent that the server knows will read the feedback lines of a repository.
_Avoid_: Listener

**Level**:
How much of Blueline an app holds in its own code, from 0 (none) to 3 (an adapter).
_Avoid_: Tier, mode
