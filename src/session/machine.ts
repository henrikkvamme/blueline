import {
  assign,
  emit,
  enqueueActions,
  fromCallback,
  raise,
  setup,
  stopChild,
  type ActorRefFrom,
} from "xstate";
import {
  blankNote,
  clearedNote,
  isKept,
  isWithAgent,
  noteAfter,
  unsentPin,
  type AgentReply,
  type Note,
  type NoteEvent,
  type Image,
  type Pin,
} from "../notes/note";
import { newHandoff } from "../notes/handoff";
import { dropped, keptOn } from "../part/store";
import {
  keepsAnother,
  keepsSame,
  keptParts,
  openedAgain,
  openPlace,
  stepBy,
  type Entered,
  type Feedback,
  type Keep,
  type Kept,
  type PartVerdicts,
  type Pending,
  type PostData,
  type PostSession,
  type Shape,
} from "./state";

/*
 * The review session as a state machine. Four regions run side by side:
 * - review: off, on the page, or on a step of a journey: entering it, switching its
 *   variant, or ready. The tree's selection says which: a step opens it, a page leaves it;
 *   on a step, the panel's chat is the step's or the page's;
 * - panel: the panel at the side, shown or hidden; hidden, the bar is its folded form;
 * - layer: what is open over the page, at most one: a picker, as the journeys or this page's
 *   notes, the key menu, the g menu, a pointed note or the send sheet;
 * - agent: whether it reads the agent's replies: while a step is open, or a note waits.
 * The machine never touches the page. It asks the actors the dev tools give it to open a
 * step, apply a variant, post notes and read replies.
 */

export const LAYERS = [
  "none",
  "notes",
  "variants",
  "people",
  "help",
  "go",
  "journeys",
  "here",
  "pinned",
] as const;
export type Layer = (typeof LAYERS)[number];

export interface Context extends Kept {
  readonly journeys: readonly Shape[];
  /** The page's own place for notes (part/page.ts), where a note goes off a step. */
  readonly place: string;
  /** Counts each start, so a start at the same step opens it again. */
  readonly run: number;
  /** Whether the next step builds its world again. */
  readonly fresh: boolean;
  readonly entered: Entered | undefined;
  /** What the walk opens now: it becomes `entered` once open. */
  readonly opening: Entered | undefined;
  /** What the walk leaves: the step it last started, which a key press may have stopped
   * halfway, so its variant's state can be on the page. */
  readonly leaving: Entered | undefined;
  /** The tree's selected step. */
  readonly cursor: number;
  /** The tree's selected row when it is not a step, as a note or a journey: its id. */
  readonly row: string | undefined;
  /** Whether the tree of pages and journeys unfolds over the step in the panel. A step folds
   * it to one line at the panel's top; off a step, a wide screen always shows it. */
  readonly tree: boolean;
  /** The open pointed note. */
  readonly opened: string | undefined;
  /** Whether the tools hide, so the reviewer sees the page as a user does. The walk goes
   * on under it; a reload shows the review again. */
  readonly preview: boolean;
  /** The journeys an agent listens to, null for every one, while a note waits; undefined
   * while the page cannot tell. */
  readonly listened: readonly (string | null)[] | undefined;
  /** How many posts the session started, so each has its own ID and ends by it. */
  readonly posts: number;
  /** What `u` takes back, the newest last, and what Ctrl+R does again. */
  readonly past: readonly Change[];
  readonly future: readonly Change[];
  /** When the session started, in ms: a send that waits through a reload goes when its time
   * comes, measured from here. */
  readonly startedAt: number;
}

/** How long a send waits before its lines are written, in ms, so the reviewer can take it
 * back: a message, a pin's note sent from its card, and Finish. */
export const SEND_MS = 5000;

/**
 * One action to take back: the notes and feedback it changed, as they were before. Undo
 * puts back only those, so a reply the agent gave meanwhile to another note stays.
 */
export interface Change {
  readonly label: string;
  readonly notes: readonly (readonly [id: string, note: Note | undefined])[];
  readonly feedback: readonly (readonly [step: string, feedback: Feedback | undefined])[];
  /** The step the change was on, for a settle: the walk went on, so undo goes back. */
  readonly at?: number | undefined;
  /** A send that waits (Pending), by its ID: undo takes it back before it is written. */
  readonly send?: string | undefined;
}

export type Event =
  /** Leaves the step for the page: the walk stops, and stays where it was. */
  | { readonly type: "leave" }
  /** On a step, writes to the step's chat or the page's; with no `to`, the other one. */
  | { readonly type: "chat"; readonly to?: "step" | "page" | undefined }
  | { readonly type: "preview" }
  | {
      readonly type: "start";
      readonly journey: string;
      readonly at: number;
      readonly fresh: boolean;
      /** From the journey's own row: a journey with every step settled opens them all
       * again, for another pass. */
      readonly again?: boolean | undefined;
    }
  /** `by` steps on; with `open`, only the steps not settled count, as H and L go. */
  | { readonly type: "go"; readonly by: number; readonly open?: boolean | undefined }
  | { readonly type: "jump"; readonly at: number }
  /** Opens the step's page and setup again, and scrolls its part to the middle. */
  | { readonly type: "reset" }
  | { readonly type: "variant"; readonly by: number }
  | { readonly type: "showVariant"; readonly step: string; readonly label: string }
  /** Shows or hides the panel; with no `shown`, the other way. Hiding changes only the view:
   * the walk stays on its step, and the light stays. */
  | { readonly type: "panel"; readonly shown?: boolean | undefined }
  /** Unfolds or folds the tree over the step; with no `open`, the other way. */
  | { readonly type: "tree"; readonly open?: boolean | undefined }
  /** The page changed: its notes have their own place. */
  | { readonly type: "place"; readonly place: string }
  | { readonly type: "cursor"; readonly by: number }
  /** Selects a tree row that is not a step, by its id. */
  | { readonly type: "row"; readonly id: string }
  /** Opens or closes a tree row's children, by the row's fold key. */
  | { readonly type: "fold"; readonly id: string; readonly open: boolean }
  | { readonly type: "cursorOpen"; readonly by: number }
  | { readonly type: "choose" }
  | { readonly type: "open"; readonly layer: Exclude<Layer, "none" | "pinned"> }
  | { readonly type: "close" }
  | { readonly type: "escape" }
  | { readonly type: "pin"; readonly id: string }
  | { readonly type: "point"; readonly id: string; readonly pin: Pin }
  | {
      readonly type: "write";
      readonly id: string;
      readonly step: string;
      readonly pin?: Pin | undefined;
      readonly draft: string;
      /** The screenshots with the draft, when they change. */
      readonly images?: readonly Image[] | undefined;
    }
  | {
      readonly type: "send";
      readonly id: string;
      readonly step: string;
      readonly at: number;
      readonly text?: string | undefined;
      /** The pin whose card sent it, with no words of its own: its undo opens the card. */
      readonly card?: string | undefined;
    }
  /** A send's wait is over: its lines are written. */
  | { readonly type: "due"; readonly id: string }
  /** Takes back a send that waits: nothing is written, and its words and pins go back. */
  | { readonly type: "unsend"; readonly id: string }
  | { readonly type: "noteEvent"; readonly id: string; readonly event: NoteEvent }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "failed"; readonly ids: readonly string[] }
  /** Empties the chat of the step or the page. */
  | { readonly type: "clear"; readonly step: string }
  /** A post is done, so it ends. */
  | { readonly type: "posted"; readonly child: string }
  | { readonly type: "replies"; readonly replies: Readonly<Record<string, Reply>> }
  | { readonly type: "listening"; readonly listened: readonly (string | null)[] | undefined }
  /** Says the step is right as it shows, and goes on to the next open one. A settle keeps
   * the variant the step's part shows, as the one the agent keeps in the code. On a settled
   * step that shows another variant than the one kept, it keeps the one shown; on one that
   * shows the kept variant, it only goes on. */
  | {
      readonly type: "settle";
      /** The step to settle, as one selected in the tree; the review's step when none. */
      readonly step?: number | undefined;
      readonly keep?: Keep | undefined;
      /** When, in ms: the step's notes not sent yet go with the settle, as a message. */
      readonly at?: number | undefined;
    }
  /** Opens a settled step again: it keeps no variant, and the agent works on it again. */
  | { readonly type: "reopen"; readonly step?: number | undefined }
  /** Deletes a variant of a part on the step. */
  | { readonly type: "drop"; readonly part: string; readonly variant: string }
  | { readonly type: "design"; readonly design: string }
  /** The journeys again, as the page's review follows the parts on the page. */
  | { readonly type: "journeys"; readonly journeys: readonly Shape[] }
  | { readonly type: "entered" }
  | { readonly type: "switched" }
  | { readonly type: "undo" }
  /** Ends the review once every step is settled: the last settle goes, held until now, and
   * the panel shows the hand-off. `at`, in ms, names the hand-off. */
  | { readonly type: "finish"; readonly at?: number | undefined }
  /** Shows a hand-off in the panel, by its note's ID, or with null leaves it for the tree. */
  | { readonly type: "handoff"; readonly id: string | null }
  /** Goes back from the finish: the last step opens again, and its settle does not go. */
  | { readonly type: "back" }
  | { readonly type: "redo" }
  /** The reviewer asked for variants where the step has none. */
  | { readonly type: "unvaried" };

/** The agent's answer to one note, as status.json gives it. */
export interface Reply {
  readonly state: "working" | "replied";
  readonly settled?: boolean | undefined;
  /** When the agent settled the note, in ms (io/replies.ts). */
  readonly settledAt?: number | undefined;
  readonly replies?: readonly AgentReply[];
  /** What the agent shows while it works, as a plan, in place of the last. */
  readonly progress?: AgentReply["blocks"];
}

/** What the machine tells the dev tools, to show. */
export type Emitted =
  | { readonly type: "replied"; readonly note: Note; readonly settled: boolean }
  | { readonly type: "failed" }
  | {
      readonly type: "undone";
      readonly label: string;
      readonly redo: boolean;
      /** The step whose settle it took back or did again, and whether it was settled before,
       * so its light turns from that look. */
      readonly turned?: { readonly step: string; readonly settled: boolean } | undefined;
    }
  /** The tools hide, until the reviewer asks for them again. */
  | { readonly type: "previewing" }
  /** Nothing to undo or redo. */
  | { readonly type: "nothing"; readonly redo: boolean }
  /** The step has no variants to lift. */
  | { readonly type: "unvaried" }
  /** The last open step of the journey settled: the review ended, and the tools show the
   * page. */
  | { readonly type: "done"; readonly journey: string }
  /** A send that waited was taken back: its words are back in the message field, or in the
   * card of `card`, to write again. */
  | { readonly type: "unsent"; readonly card: string | undefined; readonly finish: boolean };

/**
 * What the post actor sends the agent, at once: a chat's message with the pointed notes in
 * it, a step settled or opened again, or a variant kept.
 */
export interface Post {
  readonly kind: "note" | "settle";
  /** The chat whose newest message goes, for a note. */
  readonly ids: readonly string[];
  /** The step, for a settle. */
  readonly step?: string | undefined;
  readonly session: PostSession;
  /** A post sent once this one is, in its order, with the posts after it. */
  readonly next?: Post | undefined;
  /** For the settle that Finish sends: the hand-off's ID, which the agent answers. */
  readonly handoff?: string | undefined;
}

export interface EnterInput {
  readonly journey: string;
  readonly at: number;
  readonly variant: number;
  readonly fresh: boolean;
  readonly leaving: Entered | undefined;
  /** The variants the step's settle kept on its parts, by the part's name: the page shows
   * them, so a settled step opens as it was settled. None for an open step. */
  readonly kept: Readonly<Record<string, string>>;
}

/** The step whose part the walk keeps open while it is ready. */
export interface KeepInput {
  readonly journey: string;
  readonly at: number;
}

export interface SwitchInput {
  readonly journey: string;
  readonly at: number;
  readonly variant: number;
}

const shapeOf = (c: Context) => c.journeys.find((j) => j.id === c.journey) ?? c.journeys[0];
const stepOf = (c: Context, at = c.at) => shapeOf(c)?.steps[at];
/** Where a new note goes: the step, or the page's place off a step or with its chat. */
const noteStepOf = (c: Context) => (c.active && c.chat === "step" ? stepOf(c)?.id : c.place);
const variantOf = (c: Context, at = c.at) => {
  const step = stepOf(c, at);
  return step === undefined ? 0 : (c.variants[step.id] ?? 0);
};
const lastStep = (c: Context) => Math.max(0, (shapeOf(c)?.steps.length ?? 1) - 1);
const clamp = (c: Context, at: number) => Math.min(Math.max(at, 0), lastStep(c));
const openStepBy = (c: Context, by: number, from = c.at) =>
  stepBy(
    (shapeOf(c)?.steps ?? []).map((s) => s.id),
    c.feedback,
    from,
    by,
  );

/** Where a `go` goes. */
const goTo = (c: Context, e: { readonly by: number; readonly open?: boolean | undefined }) =>
  e.open === true ? openStepBy(c, e.by) : clamp(c, c.at + e.by);

const withNote = (c: Context, id: string, next: (n: Note | undefined) => Note | undefined) => {
  const was = c.notes.find((n) => n.id === id);
  const changed = next(was);
  if (changed === undefined) return c.notes.filter((n) => n.id !== id);
  if (was === undefined) return [...c.notes, changed];
  return c.notes.map((n) => (n.id === id ? changed : n));
};

/** A pointed note with nothing in it goes when it closes. */
const dropEmpty = (c: Context) =>
  c.opened === undefined
    ? c.notes
    : withNote(c, c.opened, (n) =>
        n !== undefined && n.thread.length === 0 && !isKept(n) ? undefined : n,
      );

/** The chat's ID: one for each step and each page. */
export const stepNoteId = (step: string) => `note-${step}`;

/** Whether the panel shows the tree of pages and journeys: unfolded over the step, or off a
 * step on a wide screen. A phone's sheet folds it off a step too, so the page stays in view. */
export const treeShown = (
  c: { readonly active: boolean; readonly tree: boolean },
  phone: boolean,
): boolean => c.tree || (!phone && !c.active);

/** Whether the page reads the agent's replies: while a note waits, and all through a walk,
 * as an agent may answer again a note it answered, or settle it. */
const readsReplies = (c: Context) => c.active || c.notes.some(isWithAgent);

const variantLabel = (c: Context, step: string) => {
  const shape = shapeOf(c)?.steps.find((s) => s.id === step);
  return shape?.variants[c.variants[step] ?? 0];
};

/** The step's own variant that a settle keeps: the one shown, on a step with variants. */
const ownOf = (c: Context, step: Shape["steps"][number]) =>
  step.variants.length > 1 ? variantLabel(c, step.id) : undefined;

/** Whether a settle on a settled step keeps another variant than the one kept: else it only
 * goes on. */
const changesKept = (c: Context, step: Shape["steps"][number], keep: Keep | undefined): boolean =>
  keepsAnother(c.feedback[step.id] ?? {}, keep, ownOf(c, step));

/** The step's variants as its settle kept them: a settled step shows its kept own variant
 * each time the walk comes to it. */
const keptVariants = (c: Context) => {
  const step = stepOf(c);
  const kept = step === undefined ? undefined : c.feedback[step.id];
  if (step === undefined || kept?.settled !== true || kept.variant === undefined) return c.variants;
  const index = step.variants.indexOf(kept.variant);
  return index < 0 ? c.variants : { ...c.variants, [step.id]: index };
};

const NO_VERDICTS: PartVerdicts = { kept: [], dropped: [] };

/** The verdicts on the part on the current step. */
const verdictsOf = (c: Context, part: string, step = stepOf(c)?.id): PartVerdicts =>
  (step === undefined ? undefined : c.feedback[step]?.parts?.[part]) ?? NO_VERDICTS;

/** The steps a start opens again for another pass, by their IDs: every step of the journey,
 * when the start comes from the journey's row and every one is settled. None otherwise. */
const passOf = (
  c: Context,
  e: { readonly journey: string; readonly again?: boolean | undefined },
) => {
  const ids = c.journeys.find((j) => j.id === e.journey)?.steps.map((s) => s.id) ?? [];
  const settled = ids.length > 0 && ids.every((id) => c.feedback[id]?.settled === true);
  return e.again === true && settled ? ids : [];
};

/** The notes and feedback with the steps opened again: each step as `openedAgain` has it,
 * and the notes the reviewer settled on them open. */
const reopened = (c: Context, steps: readonly string[]) => ({
  notes: c.notes.map((n) =>
    steps.includes(n.step) && n.settledBy === "you" ? noteAfter(n, { type: "reopen" }) : n,
  ),
  feedback: {
    ...c.feedback,
    ...Object.fromEntries(steps.map((id) => [id, openedAgain(c.feedback[id] ?? {})])),
  },
});

/**
 * The notes after a message: the chat, with the place's pointed notes in its message, and
 * without them as notes, as they wait no more. With pointed notes, a send with no words is
 * a message too. Undefined when there is nothing to send.
 */
function sentOf(
  c: Context,
  e: {
    readonly id: string;
    readonly step: string;
    readonly at: number;
    readonly text?: string | undefined;
  },
) {
  const variant = variantLabel(c, e.step);
  const was = c.notes.find((n) => n.id === e.id) ?? blankNote(e.id, e.step);
  const pinned = c.notes.filter((n) => n.step === e.step && n.pin !== undefined && isKept(n));
  const pins = pinned.flatMap((n) =>
    n.pin === undefined
      ? []
      : [
          {
            id: n.id,
            pin: n.pin,
            text: n.draft.trim(),
            ...(n.images === undefined ? {} : { images: n.images }),
          },
        ],
  );
  const sent = noteAfter(was, { type: "send", at: e.at, variant, text: e.text, pins });
  if (sent.thread.length === was.thread.length) return undefined;
  const notes = [
    ...c.notes.flatMap((n) => (n.id === sent.id ? [sent] : pinned.includes(n) ? [] : [n])),
    ...(c.notes.some((n) => n.id === sent.id) ? [] : [sent]),
  ];
  return { notes, ids: [sent.id] };
}

/** The step whose settle a change takes back or does again, and whether it is settled now,
 * before the change. */
const turnedBy = (c: Context, change: Change) => {
  const step = change.at === undefined ? undefined : change.feedback[0]?.[0];
  return step === undefined ? undefined : { step, settled: c.feedback[step]?.settled === true };
};

/** Whether the step's settle reads otherwise to the agent: it turned settled or open, or it
 * stays settled with another variant kept. */
const turns = (a: Feedback | undefined, b: Feedback | undefined) =>
  (a?.settled === true) !== (b?.settled === true) || (a?.settled === true && !keepsSame(a, b));

/**
 * The settle lines for the steps whose settle the change to `next` turns, in their order, as
 * one chain of posts: a step settled or opened, or one that keeps another variant. Each line
 * carries the feedback as it stands once its own step turned, so its `left` counts the steps
 * open then. The last settle, which waits for Finish, has no line: the agent never heard of
 * it, so it has nothing to take back.
 */
function turnedLines(
  c: Context,
  next: Pick<Context, "notes" | "feedback" | "finish">,
  steps: readonly string[],
): Post | undefined {
  const turned = steps.filter(
    (id) =>
      turns(c.feedback[id], next.feedback[id]) && id !== c.finish?.step && id !== next.finish?.step,
  );
  let feedback = c.feedback;
  const posts = turned.map((id): Post => {
    const { [id]: _, ...rest } = feedback;
    const f = next.feedback[id];
    feedback = f === undefined ? rest : { ...feedback, [id]: f };
    return { kind: "settle", ids: [], step: id, session: { ...c, ...next, feedback } };
  });
  return posts.reduceRight<Post | undefined>(
    (after, post) => ({ ...post, next: after }),
    undefined,
  );
}

/** How many actions `u` can take back. */
const HISTORY = 50;

/** The parts of the session that a line is written from, and no more, so a send that waits
 * keeps only what it needs through a reload. */
const sessionOf = (c: PostSession): PostSession => ({
  journey: c.journey,
  variants: c.variants,
  feedback: c.feedback,
  notes: c.notes,
  finish: c.finish,
});

/** A chain of posts as a list, in its order, to keep. */
const listOf = (post: Post | undefined): readonly PostData[] =>
  post === undefined
    ? []
    : [
        {
          kind: post.kind,
          ids: post.ids,
          ...(post.step === undefined ? {} : { step: post.step }),
          ...(post.handoff === undefined ? {} : { handoff: post.handoff }),
          session: sessionOf(post.session),
        },
        ...listOf(post.next),
      ];

/** The list of posts as one chain again, sent in its order. */
const chainOf = (posts: readonly PostData[]): Post | undefined =>
  posts.reduceRight<Post | undefined>((next, post) => ({ ...post, next }), undefined);

/** The send's words put back where they came from: the message leaves its chat, its words
 * and screenshots go back to the chat's field, and its pins wait on their elements again.
 * A reply that came meanwhile, or a later message, stays. */
function takenBack(c: Context, p: Pending) {
  let notes = c.notes;
  for (const [id, before] of p.before.notes) {
    const now = notes.find((n) => n.id === id);
    let next: Note | undefined;
    if (id === p.chat?.id) {
      const at = p.chat.at;
      const sent = now?.thread.find((m) => m.by === "you" && m.at === at);
      const thread = (now?.thread ?? []).filter((m) => m !== sent);
      const words = sent?.text ?? "";
      const draft = [words, now?.draft ?? ""].filter((w) => w !== "").join("\n");
      const images = [...(sent?.images ?? []), ...(now?.images ?? [])];
      const base =
        before !== null && before.thread.length === thread.length
          ? before
          : (now ?? blankNote(id, before?.step ?? ""));
      const { images: _, ...rest } = base;
      next = { ...rest, thread, draft, ...(images.length === 0 ? {} : { images }) };
      if (next.thread.length === 0 && next.draft === "" && before === null) next = undefined;
      // A pin sent with it waits on its element again; a hand-off it made goes.
    } else next = before === null ? undefined : (now ?? before);
    notes =
      next === undefined
        ? notes.filter((n) => n.id !== id)
        : now === undefined
          ? [...notes, next]
          : notes.map((n) => (n.id === id ? next : n));
  }
  const feedback = { ...c.feedback };
  for (const [step, f] of p.before.feedback)
    if (f === null) delete feedback[step];
    else feedback[step] = f;
  return { notes, feedback };
}

/** What an event changes that `u` can take back; undefined when it is not undoable. */
function changeOf(c: Context, event: Event): Change | undefined {
  const note = (id: string, label: string): Change => ({
    label,
    notes: [[id, c.notes.find((n) => n.id === id)]],
    feedback: [],
  });
  const feedback = (label: string): Change | undefined => {
    const step = stepOf(c);
    return step === undefined
      ? undefined
      : { label, notes: [], feedback: [[step.id, c.feedback[step.id]]] };
  };
  switch (event.type) {
    case "remove":
      return note(event.id, "Removed an annotation");
    case "noteEvent":
      return event.event.type === "settle"
        ? note(event.id, "Settled an annotation")
        : event.event.type === "reopen"
          ? note(event.id, "Reopened an annotation")
          : undefined;
    case "settle":
    case "reopen": {
      const step = stepOf(c, event.step ?? c.at);
      if (step === undefined) return undefined;
      const settled = c.feedback[step.id]?.settled === true;
      const keep = event.type === "settle" ? event.keep : undefined;
      // A settle on a settled step that keeps the same variant changes nothing.
      if (event.type === "reopen" ? !settled : settled && !changesKept(c, step, keep))
        return undefined;
      const kept = keep?.variant ?? ownOf(c, step);
      return {
        label:
          event.type === "reopen"
            ? "Opened the step again"
            : settled
              ? `Kept ${kept ?? "another variant"}`
              : "Settled the step",
        notes: c.notes.filter((n) => n.step === step.id).map((n) => [n.id, n] as const),
        feedback: [[step.id, c.feedback[step.id]]],
        at: c.at,
      };
    }
    case "start": {
      const steps = passOf(c, event);
      if (steps.length === 0) return undefined;
      return {
        label: "Opened the journey again",
        notes: c.notes.filter((n) => steps.includes(n.step)).map((n) => [n.id, n] as const),
        feedback: steps.map((id) => [id, c.feedback[id]] as const),
      };
    }
    case "drop":
      return feedback(`Deleted ${event.variant}`);
    case "clear":
      return note(stepNoteId(event.step), "Cleared the chat");
    default:
      return undefined;
  }
}

/** The change as things are now, for the same notes and steps: what takes it back again. */
const inverseOf = (c: Context, change: Change): Change => ({
  label: change.label,
  notes: change.notes.map(([id]) => [id, c.notes.find((n) => n.id === id)] as const),
  feedback: change.feedback.map(([step]) => [step, c.feedback[step]] as const),
  at: change.at,
});

/** Puts the notes and feedback back as the change has them. */
function restore(c: Context, change: Change) {
  let notes = c.notes;
  for (const [id, note] of change.notes) {
    const without = notes.filter((n) => n.id !== id);
    const at = notes.findIndex((n) => n.id === id);
    notes =
      note === undefined
        ? without
        : at < 0
          ? [...notes, note]
          : notes.map((n) => (n.id === id ? note : n));
  }
  const feedback = { ...c.feedback };
  for (const [step, f] of change.feedback)
    if (f === undefined) delete feedback[step];
    else feedback[step] = f;
  return { notes, feedback };
}

/** Whether the event writes lines at once: then the sends that wait go first, so the agent
 * reads every line in its order. A settle that only goes on, and an undo that takes back a
 * send, write none. */
function writesNow(c: Context, e: Event): boolean {
  switch (e.type) {
    case "settle": {
      const step = stepOf(c, e.step ?? c.at);
      return (
        step !== undefined &&
        (c.feedback[step.id]?.settled !== true || changesKept(c, step, e.keep))
      );
    }
    case "undo":
      return c.past.at(-1)?.send === undefined && c.past.length > 0;
    case "redo":
      return c.future.length > 0;
    case "start":
      return passOf(c, e).length > 0;
    case "reopen":
    case "back":
      return true;
    default:
      return false;
  }
}

export const sessionMachine = setup({
  types: {
    context: {} as Context,
    events: {} as Event,
    input: {} as {
      readonly kept: Kept;
      readonly journeys: readonly Shape[];
      readonly now: number;
      /** The page's place; none in a test that has no page. */
      readonly place?: string | undefined;
    },
    emitted: {} as Emitted,
  },
  actors: {
    // The dev tools give the real actors; these stand in for tests and do nothing.
    enterStep: fromCallback<Event, EnterInput>(() => undefined),
    switchVariant: fromCallback<Event, SwitchInput>(() => undefined),
    post: fromCallback<Event, Post>(() => undefined),
    keep: fromCallback<Event, KeepInput>(() => undefined),
    poll: fromCallback<Event>(() => undefined),
  },
  guards: {
    wasActive: ({ context }) => context.active,
    hasVariants: ({ context }) => (stepOf(context)?.variants.length ?? 0) > 1,
    variantStale: ({ context }) =>
      context.entered !== undefined && context.entered.variant !== variantOf(context),
    readsReplies: ({ context }) => readsReplies(context),
    readsNoReplies: ({ context }) => !readsReplies(context),
  },
  actions: {
    // The sends that wait go now, before the lines of this event.
    flush: enqueueActions(({ context, event, enqueue }) => {
      if (context.pending.length === 0 || !writesNow(context, event)) return;
      for (const p of context.pending) {
        enqueue.cancel(p.id);
        const input = chainOf(p.posts);
        if (input !== undefined) enqueue.spawnChild("post", { id: p.id, input });
      }
      enqueue.assign(({ context: now }) => ({
        pending: [],
        past: now.past.filter((change) => change.send === undefined),
      }));
    }),
    remember: assign(({ context, event }) => {
      const change = changeOf(context, event);
      return change === undefined
        ? {}
        : { past: [...context.past, change].slice(-HISTORY), future: [] };
    }),
    // A step opens with its own chat, and the tree's selection on it.
    activate: assign({
      active: true,
      chat: "step" as const,
      preview: false,
      cursor: ({ context }) => context.at,
      row: undefined,
      handoff: null,
    }),
    // The page view: the panel shows the page's chat.
    deactivate: assign({
      active: false,
      row: undefined,
      tree: false,
      entered: undefined,
      opening: undefined,
      preview: false,
    }),
    // A journey started again once every step is settled opens its steps for another pass.
    // Each step opened writes its line, so the agent knows that the review goes on.
    anotherPass: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== "start") return;
      const steps = passOf(context, event);
      if (steps.length === 0) return;
      const next = reopened(context, steps);
      enqueue.assign(next);
      // The lines name the journey that starts again, not the one the start leaves.
      const lines = turnedLines(
        { ...context, journey: event.journey },
        { ...next, finish: context.finish },
        steps,
      );
      if (lines === undefined) return;
      enqueue.assign({ posts: context.posts + 1 });
      enqueue.spawnChild("post", { id: `post-${context.posts}`, input: lines });
    }),
    nextRun: assign({ run: ({ context }) => context.run + 1 }),
    /**
     * u takes the newest change back, and Ctrl+R does it again. A step whose settled state
     * turns writes its settle line, so the agent never keeps a settle that the page took
     * back. A settle done again on the last open step waits for Finish, as a settle does.
     */
    turn: enqueueActions(({ context, event, enqueue }) => {
      const redo = event.type === "redo";
      const change = (redo ? context.future : context.past).at(-1);
      // A send that waits is the newest change: undo takes it back, before it is written.
      // After a reload no change is kept, and undo takes back the newest send that waits.
      const send = redo
        ? undefined
        : (change?.send ?? (change === undefined ? context.pending.at(-1)?.id : undefined));
      if (send !== undefined) {
        enqueue.raise({ type: "unsend", id: send });
        return;
      }
      if (change === undefined) {
        enqueue.emit({ type: "nothing", redo });
        return;
      }
      const restored = restore(context, change);
      const ids = shapeOf(context)?.steps.map((s) => s.id) ?? [];
      const step = change.at === undefined ? undefined : change.feedback[0]?.[0];
      // Back from the finish: the last step is open again, and its settle does not go.
      const kept =
        context.finish !== null && restored.feedback[context.finish.step]?.settled !== true
          ? null
          : context.finish;
      // A settle done again on the last open step waits for Finish. A step that stays
      // settled, and keeps another variant, does not: its line goes.
      const finish =
        kept === null &&
        step !== undefined &&
        context.feedback[step]?.settled !== true &&
        restored.feedback[step]?.settled === true &&
        openPlace(ids, restored.feedback, 0).open === 0
          ? { step, ids: [] }
          : kept;
      const inverse = inverseOf(context, change);
      enqueue.assign({
        ...restored,
        finish,
        past: redo ? [...context.past, inverse] : context.past.slice(0, -1),
        future: redo ? context.future.slice(0, -1) : [...context.future, inverse],
      });
      const lines = turnedLines(
        context,
        { ...restored, finish },
        change.feedback.map(([id]) => id),
      );
      if (lines !== undefined) {
        enqueue.assign({ posts: context.posts + 1 });
        enqueue.spawnChild("post", { id: `post-${context.posts}`, input: lines });
      }
      if (finish !== null && finish !== context.finish) {
        if (context.preview) enqueue.raise({ type: "preview" });
        enqueue.raise({ type: "panel", shown: true });
      }
      // A settle taken back goes back to its step: also from the page, where the review's
      // last settle ended the walk.
      // A step that keeps another variant again opens again too, so the page shows it.
      const shows =
        step !== undefined &&
        change.at !== undefined &&
        stepOf(context, change.at)?.id === step &&
        restored.feedback[step]?.settled === true &&
        !keepsSame(context.feedback[step], restored.feedback[step]);
      if (!redo && change.at !== undefined && !context.active)
        enqueue.raise({ type: "start", journey: context.journey, at: change.at, fresh: false });
      else if (change.at !== undefined && (change.at !== context.at || shows))
        enqueue.raise({ type: "jump", at: change.at });
      enqueue.emit({
        type: "undone",
        label: change.label,
        redo,
        turned: turnedBy(context, change),
      });
    }),
  },
}).createMachine({
  id: "session",
  type: "parallel",
  context: ({ input }) => ({
    ...input.kept,
    journey: input.journeys.some((j) => j.id === input.kept.journey)
      ? input.kept.journey
      : (input.journeys[0]?.id ?? ""),
    journeys: input.journeys,
    place: input.place ?? "",
    run: 0,
    fresh: false,
    entered: undefined,
    opening: undefined,
    leaving: undefined,
    cursor: input.kept.at,
    row: undefined,
    tree: false,
    opened: undefined,
    preview: false,
    listened: undefined,
    posts: 0,
    past: [],
    future: [],
    startedAt: input.now,
  }),
  // The sends that waited through a reload go when their time comes, or at once.
  entry: enqueueActions(({ context, enqueue }) => {
    for (const p of context.pending)
      enqueue.raise(
        { type: "due", id: p.id },
        { id: p.id, delay: Math.max(0, p.due - context.startedAt) },
      );
  }),
  on: {
    listening: { actions: assign({ listened: ({ event }) => event.listened }) },
    journeys: { actions: assign({ journeys: ({ event }) => event.journeys }) },
    place: { actions: assign({ place: ({ event }) => event.place }) },
    chat: {
      actions: assign({
        chat: ({ context, event }) => event.to ?? (context.chat === "step" ? "page" : "step"),
      }),
    },
    unvaried: { actions: emit({ type: "unvaried" }) },
    preview: {
      // The preview hides the tools in both modes, Notes and Review.
      actions: enqueueActions(({ context, enqueue }) => {
        enqueue.assign({ preview: !context.preview });
        if (!context.preview) enqueue.emit({ type: "previewing" });
      }),
    },
    write: {
      actions: assign({
        notes: ({ context, event }) =>
          withNote(context, event.id, (n) =>
            noteAfter(n ?? blankNote(event.id, event.step, event.pin), {
              type: "write",
              draft: event.draft,
              images: event.images,
            }),
          ),
      }),
    },
    noteEvent: {
      actions: [
        "remember",
        assign({
          notes: ({ context, event }) =>
            withNote(context, event.id, (n) => (n === undefined ? n : noteAfter(n, event.event))),
        }),
      ],
    },
    remove: {
      actions: [
        "remember",
        assign({
          notes: ({ context, event }) => withNote(context, event.id, () => undefined),
          opened: ({ context, event }) =>
            context.opened === event.id ? undefined : context.opened,
        }),
      ],
    },
    undo: { actions: ["flush", "turn"] },
    redo: { actions: ["flush", "turn"] },
    // A send's wait is over: its lines go, and undo takes it back no more.
    due: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const p = context.pending.find((x) => x.id === event.id);
        if (p === undefined) return;
        enqueue.assign({
          pending: context.pending.filter((x) => x.id !== p.id),
          past: context.past.filter((change) => change.send !== p.id),
        });
        const input = chainOf(p.posts);
        if (input !== undefined) enqueue.spawnChild("post", { id: p.id, input });
      }),
    },
    // A send taken back before it went: nothing is written. Its words go back to the field
    // and its pins to their elements; a pin's card opens again. A Finish taken back shows the
    // finish again.
    unsend: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const p = context.pending.find((x) => x.id === event.id);
        if (p === undefined) return;
        enqueue.cancel(p.id);
        const { notes, feedback } = takenBack(context, p);
        enqueue.assign({
          notes,
          feedback,
          pending: context.pending.filter((x) => x.id !== p.id),
          past: context.past.filter((change) => change.send !== p.id),
        });
        const finish = p.before.finish;
        if (finish !== undefined) {
          enqueue.assign({ finish, handoff: null });
          enqueue.raise({
            type: "start",
            journey: context.journey,
            at: p.before.at ?? context.at,
            fresh: false,
          });
        }
        if (p.card !== undefined) enqueue.raise({ type: "pin", id: p.card });
        enqueue.emit({ type: "unsent", card: p.card, finish: finish !== undefined });
      }),
    },
    posted: { actions: stopChild(({ event }) => event.child) },
    clear: {
      actions: [
        "remember",
        assign({
          notes: ({ context, event }) =>
            context.notes.map((n) => (n.id === stepNoteId(event.step) ? clearedNote(n) : n)),
        }),
      ],
    },
    failed: {
      actions: [
        assign({
          // The words go back to the draft, and the pointed notes wait again.
          notes: ({ context, event }) =>
            context.notes.flatMap((n) =>
              event.ids.includes(n.id)
                ? [
                    noteAfter(n, { type: "failed" }),
                    ...(n.thread.at(-1)?.pins ?? []).map((p) => unsentPin(n.step, p)),
                  ]
                : [n],
            ),
        }),
        emit({ type: "failed" }),
      ],
    },
    replies: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        let variants = context.variants;
        const notes = context.notes.map((n) => {
          const reply = event.replies[n.id];
          if (reply === undefined) return n;
          const fresh = (reply.replies ?? []).slice(
            n.thread.filter((m) => m.by === "agent").length + (n.skip ?? 0),
          );
          // A settle stays in the status file: once the reviewer wrote again, it is an old one.
          const wrote = Math.max(0, ...n.thread.filter((m) => m.by === "you").map((m) => m.at));
          const settled =
            reply.settled === true && (reply.settledAt === undefined || reply.settledAt >= wrote);
          if (fresh.length === 0 && !settled)
            return reply.state === "working"
              ? noteAfter(n, { type: "working", progress: reply.progress })
              : n;
          const next = noteAfter(n, {
            type: "reply",
            at: n.thread.at(-1)?.at ?? 0,
            replies: fresh,
            settled,
          });
          if (next.state === n.state && next.thread.length === n.thread.length) return n;
          enqueue.emit({ type: "replied", note: next, settled: next.state === "settled" });
          // The agent's variant shows at once.
          const label = fresh.at(-1)?.variant;
          const index =
            label === undefined
              ? -1
              : (shapeOf(context)
                  ?.steps.find((s) => s.id === n.step)
                  ?.variants.indexOf(label) ?? -1);
          if (index >= 0) variants = { ...variants, [n.step]: index };
          return next;
        });
        // The agent settled a step's note, as the reviewer told it: the step is settled.
        let feedback = context.feedback;
        for (const n of notes)
          if (
            n.id === stepNoteId(n.step) &&
            n.state === "settled" &&
            context.notes.find((o) => o.id === n.id)?.state !== "settled"
          )
            feedback = { ...feedback, [n.step]: { ...feedback[n.step], settled: true } };
        enqueue.assign({ notes, variants, feedback });
      }),
    },
    send: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const message = sentOf(context, event);
        if (message === undefined) return;
        const { notes, ids } = message;
        // The open pointed note went with the message: its card closes.
        if (context.opened !== undefined && !notes.some((n) => n.id === context.opened))
          enqueue.raise({ type: "close" });
        // A message on a settled step opens it again.
        const step = context.feedback[event.step];
        const feedback =
          step?.settled === true
            ? { ...context.feedback, [event.step]: { ...step, settled: false } }
            : context.feedback;
        const session = { ...context, notes, feedback };
        const note: Post = { kind: "note", ids, session };
        // The step opened again goes first, so the agent reads the message on an open step.
        // The last settle, which waits for Finish, never went: it has no line to take back.
        const chain: Post =
          step?.settled === true && context.finish?.step !== event.step
            ? { kind: "settle", ids: [], step: event.step, session, next: note }
            : note;
        // It waits before it is written, so the reviewer can take it back.
        const id = `send-${String(event.at)}-${String(context.posts)}`;
        const taken = context.notes.filter(
          (n) => n.id === event.id || (!notes.some((o) => o.id === n.id) && n.step === event.step),
        );
        const pending: Pending = {
          id,
          due: event.at + SEND_MS,
          posts: listOf(chain),
          chat: { id: event.id, at: event.at },
          ...(event.card === undefined ? {} : { card: event.card }),
          before: {
            notes: [
              [event.id, context.notes.find((n) => n.id === event.id) ?? null],
              ...taken.filter((n) => n.id !== event.id).map((n) => [n.id, n] as const),
            ],
            feedback: step?.settled === true ? [[event.step, step]] : [],
          },
        };
        enqueue.assign({
          notes,
          feedback,
          posts: context.posts + 1,
          pending: [...context.pending, pending],
          past: [
            ...context.past,
            { label: "Sent a message", notes: [], feedback: [], send: id },
          ].slice(-HISTORY),
          future: [],
        });
        enqueue.raise({ type: "due", id }, { id, delay: SEND_MS });
      }),
    },
    settle: {
      actions: [
        "remember",
        "flush",
        enqueueActions(({ context, event, enqueue }) => {
          const at = event.step ?? context.at;
          const step = stepOf(context, at);
          if (step === undefined) return;
          const was: Feedback = context.feedback[step.id] ?? {};
          const ids = shapeOf(context)?.steps.map((s) => s.id) ?? [];
          /** The walk goes on to the next open step, or back to one before when none is
           * after, from the page and from the tree alike: the walk and the selection go there. */
          const goOn = (feedback: Readonly<Record<string, Feedback>>) => {
            const after = stepBy(ids, feedback, at, 1);
            const next = after !== at ? after : stepBy(ids, feedback, at, -1);
            enqueue.assign({ cursor: next, row: undefined });
            if (next !== context.at) enqueue.raise({ type: "go", by: next - context.at });
          };
          // A settled step that shows the variant it kept is right as it is: the walk goes on.
          const again = was.settled === true;
          if (again && !changesKept(context, step, event.keep)) {
            goOn(context.feedback);
            return;
          }
          // The notes not sent yet go with the settle, so none is lost: the agent works on
          // them while the step stays settled.
          const message = sentOf(context, {
            id: stepNoteId(step.id),
            step: step.id,
            at: event.at ?? 0,
          });
          // Settling settles the step's other notes, also one the agent works on.
          const notes = (message?.notes ?? context.notes).map((n) =>
            n.step !== step.id || message?.ids.includes(n.id) === true
              ? n
              : noteAfter(n, { type: "settle" }),
          );
          // The settle keeps the variant shown: of the step's part, and of the step's own. On
          // a settled step, the variant kept before is kept no more, as if it never was.
          const parts =
            event.keep !== undefined
              ? {
                  ...was.parts,
                  [event.keep.part]: keptOn(
                    verdictsOf(context, event.keep.part),
                    event.keep.variant,
                  ),
                }
              : was.parts;
          const own = ownOf(context, step);
          const feedback = {
            ...context.feedback,
            [step.id]: {
              ...was,
              settled: true,
              ...(parts === undefined ? {} : { parts }),
              ...(own === undefined ? {} : { variant: own }),
            },
          };
          enqueue.assign({ notes, feedback });
          if (context.opened !== undefined && !notes.some((n) => n.id === context.opened))
            enqueue.raise({ type: "close" });
          const held = context.finish;
          const sent = message?.ids ?? [];
          // The step whose settle waits for Finish keeps the new variant: Finish sends it.
          if (held !== null && held.step === step.id) {
            enqueue.assign({ finish: { step: held.step, ids: [...held.ids, ...sent] } });
            return;
          }
          // The last open step settled: the panel asks the reviewer to finish, and the settle
          // waits for that, so the agent wakes once, at the end. The walk stays on its step.
          if (!again && openPlace(ids, feedback, context.at).open === 0) {
            enqueue.assign({ finish: { step: step.id, ids: sent } });
            if (context.preview) enqueue.raise({ type: "preview" });
            enqueue.raise({ type: "panel", shown: true });
            return;
          }
          // A line goes at once: while a finish waits, its step counts as open in it.
          const session = { ...context, notes, feedback };
          enqueue.assign({ posts: context.posts + 1 });
          // The notes go after the settle, so the listener reads them with it.
          enqueue.spawnChild("post", {
            id: `post-${context.posts}`,
            input: {
              kind: "settle",
              ids: [],
              step: step.id,
              session,
              next: message === undefined ? undefined : { kind: "note", ids: message.ids, session },
            },
          });
          goOn(feedback);
        }),
      ],
    },
    // Opening the step again keeps no variant and opens the notes the reviewer settled, as
    // the reviewer may settle on another. The settle that waits for Finish never went: opening
    // its step takes it back with no line, as Back does. Opening another step while it waits
    // sends it, as that step is the last open one no more.
    reopen: {
      actions: [
        "remember",
        "flush",
        enqueueActions(({ context, event, enqueue }) => {
          const step = stepOf(context, event.step ?? context.at);
          if (step === undefined || context.feedback[step.id]?.settled !== true) return;
          const { notes, feedback } = reopened(context, [step.id]);
          const held = context.finish;
          enqueue.assign({ notes, feedback, finish: null, posts: context.posts + 1 });
          const session = { ...context, notes, feedback, finish: null };
          const heldNotes = (ids: readonly string[]): Post | undefined =>
            ids.length === 0 ? undefined : { kind: "note", ids, session };
          if (held?.step === step.id) {
            const notesHeld = heldNotes(held.ids);
            if (notesHeld !== undefined)
              enqueue.spawnChild("post", { id: `post-${context.posts}`, input: notesHeld });
            return;
          }
          enqueue.spawnChild("post", {
            id: `post-${context.posts}`,
            input: {
              kind: "settle",
              ids: [],
              step: step.id,
              // The held settle has not gone yet, as this line goes.
              session: { ...session, finish: held },
              next:
                held === null
                  ? undefined
                  : {
                      kind: "settle",
                      ids: [],
                      step: held.step,
                      session,
                      next: heldNotes(held.ids),
                    },
            },
          });
        }),
      ],
    },
    // Finish ends the review: the last settle goes, with the notes held with it, and the
    // panel shows the hand-off, where the agent's answer comes in. The settle line names the
    // hand-off, so the agent answers the review there. The walk stays on its step, so the
    // journey opened again goes on there.
    finish: {
      guard: ({ context }) => context.finish !== null,
      actions: enqueueActions(({ context, event, enqueue }) => {
        const held = context.finish;
        if (held === null) return;
        const at = event.at ?? 0;
        const handoff = newHandoff(context.journey, at);
        const notes = [...context.notes.filter((n) => n.id !== handoff.id), handoff];
        const session = { ...context, finish: null, notes };
        // It waits before it is written, as a message does: undo shows the finish again.
        const id = `send-${String(at)}-${String(context.posts)}`;
        const pending: Pending = {
          id,
          due: at + SEND_MS,
          posts: listOf({
            kind: "settle",
            ids: [],
            step: held.step,
            session,
            handoff: handoff.id,
            next: held.ids.length === 0 ? undefined : { kind: "note", ids: held.ids, session },
          }),
          handoff: handoff.id,
          before: {
            notes: [[handoff.id, context.notes.find((n) => n.id === handoff.id) ?? null]],
            feedback: [],
            finish: held,
            at: context.at,
          },
        };
        enqueue.assign({
          finish: null,
          posts: context.posts + 1,
          notes,
          pending: [...context.pending, pending],
          past: [
            ...context.past,
            { label: "Finished the review", notes: [], feedback: [], send: id },
          ].slice(-HISTORY),
          future: [],
        });
        enqueue.raise({ type: "due", id }, { id, delay: SEND_MS });
        enqueue.raise({ type: "leave" });
        enqueue.assign({ handoff: handoff.id });
        enqueue.emit({ type: "done", journey: context.journey });
      }),
    },
    // The hand-off shows, or leaves for the tree. An answer read there is done with: its note
    // settles, so it counts as news no more.
    handoff: {
      actions: assign(({ context, event }) => {
        const was = context.notes.find((n) => n.id === context.handoff);
        const read =
          event.id === null && was?.state === "replied"
            ? withNote(context, was.id, (n) =>
                n === undefined ? n : noteAfter(n, { type: "settle" }),
              )
            : context.notes;
        return { handoff: event.id, notes: read };
      }),
    },
    // Back from the finish takes the last settle back, as u does. With no undo to take, as
    // after a reload, the step opens again by itself; the agent never heard of its settle,
    // and the notes the chat shows as sent go now.
    back: {
      guard: ({ context }) => context.finish !== null,
      actions: [
        "flush",
        enqueueActions(({ context, enqueue }) => {
          const held = context.finish;
          if (held === null) return;
          const last = context.past.at(-1);
          // The settle that settled it, not a change of the variant it kept.
          if (
            last?.at !== undefined &&
            last.feedback[0]?.[0] === held.step &&
            last.feedback[0][1]?.settled !== true
          ) {
            enqueue.raise({ type: "undo" });
            return;
          }
          const feedback = {
            ...context.feedback,
            [held.step]: { ...context.feedback[held.step], settled: false },
          };
          enqueue.assign({ feedback, finish: null });
          if (held.ids.length === 0) return;
          enqueue.assign({ posts: context.posts + 1 });
          enqueue.spawnChild("post", {
            id: `post-${context.posts}`,
            input: { kind: "note", ids: held.ids, session: { ...context, feedback, finish: null } },
          });
        }),
      ],
    },
    drop: {
      actions: [
        "remember",
        enqueueActions(({ context, enqueue, event }) => {
          const step = stepOf(context);
          if (step === undefined) return;
          const was: Feedback = context.feedback[step.id] ?? {};
          const parts = {
            ...was.parts,
            [event.part]: dropped(verdictsOf(context, event.part), event.variant),
          };
          // The agent reads the verdicts with the reviewer's next note, and the reasons in it.
          enqueue.assign({ feedback: { ...context.feedback, [step.id]: { ...was, parts } } });
        }),
      ],
    },
    design: { actions: assign({ design: ({ event }) => event.design }) },
    showVariant: {
      actions: assign({
        variants: ({ context, event }) => {
          const shape = shapeOf(context)?.steps.find((s) => s.id === event.step);
          const index = shape?.variants.indexOf(event.label) ?? -1;
          return index < 0 ? context.variants : { ...context.variants, [event.step]: index };
        },
      }),
    },
  },
  states: {
    review: {
      initial: "starting",
      states: {
        starting: { always: [{ guard: "wasActive", target: "on" }, { target: "off" }] },
        off: {
          on: {
            start: {
              target: "on",
              actions: [
                "remember",
                "flush",
                "anotherPass",
                assign({
                  journey: ({ event }) => event.journey,
                  at: ({ event }) => event.at,
                  cursor: ({ event }) => event.at,
                  row: undefined,
                  fresh: ({ event }) => event.fresh,
                }),
                "activate",
                "nextRun",
              ],
            },
            choose: {
              target: "on",
              actions: [assign({ at: ({ context }) => context.cursor }), "activate", "nextRun"],
            },
          },
        },
        on: {
          initial: "entering",
          on: {
            leave: {
              target: "off",
              actions: ["deactivate", raise({ type: "panel", shown: true })],
            },
            start: {
              target: ".entering",
              reenter: true,
              actions: [
                "remember",
                "flush",
                "anotherPass",
                assign({
                  journey: ({ event }) => event.journey,
                  at: ({ event }) => event.at,
                  cursor: ({ event }) => event.at,
                  row: undefined,
                  fresh: ({ event }) => event.fresh,
                  preview: false,
                  chat: "step" as const,
                  handoff: null,
                }),
                "nextRun",
              ],
            },
            go: {
              // h and l go to every step, settled too, so the reviewer can go back to one
              // just settled; H and L pass over the settled ones.
              guard: ({ context, event }) => goTo(context, event) !== context.at,
              target: ".entering",
              reenter: true,
              actions: assign({
                at: ({ context, event }) => goTo(context, event),
                cursor: ({ context, event }) => goTo(context, event),
                row: undefined,
              }),
            },
            // A step chosen by its name opens on its own chat.
            jump: {
              target: ".entering",
              reenter: true,
              actions: assign({
                at: ({ context, event }) => clamp(context, event.at),
                cursor: ({ context, event }) => clamp(context, event.at),
                row: undefined,
                chat: "step" as const,
              }),
            },
            choose: {
              target: ".entering",
              reenter: true,
              actions: assign({ at: ({ context }) => context.cursor, chat: "step" as const }),
            },
            // The step again, its world built from the start.
            reset: {
              target: ".entering",
              reenter: true,
              actions: [assign({ fresh: true }), "nextRun"],
            },
            variant: {
              guard: "hasVariants",
              actions: assign({
                variants: ({ context, event }) => {
                  const step = stepOf(context);
                  const count = step?.variants.length ?? 0;
                  if (step === undefined || count < 2) return context.variants;
                  const next =
                    ((((context.variants[step.id] ?? 0) + event.by) % count) + count) % count;
                  return { ...context.variants, [step.id]: next };
                },
              }),
            },
          },
          states: {
            // A step opens with the tree folded, so the panel shows the step.
            // A settled step opens with the variants its settle kept.
            entering: {
              entry: assign(({ context }) => {
                const variants = keptVariants(context);
                return {
                  tree: false,
                  variants,
                  leaving: context.opening,
                  opening: {
                    journey: context.journey,
                    at: context.at,
                    variant: variantOf({ ...context, variants }),
                    run: context.run,
                  },
                };
              }),
              invoke: {
                src: "enterStep",
                input: ({ context }) => ({
                  journey: context.journey,
                  at: context.at,
                  variant: variantOf(context),
                  fresh: context.fresh,
                  leaving: context.leaving,
                  kept: keptParts(context.feedback[stepOf(context)?.id ?? ""]),
                }),
              },
              on: {
                entered: {
                  target: "ready",
                  actions: assign({
                    fresh: false,
                    entered: ({ context }) => context.opening,
                  }),
                },
              },
            },
            switching: {
              entry: assign({
                opening: ({ context }) =>
                  context.entered === undefined
                    ? undefined
                    : { ...context.entered, variant: variantOf(context) },
              }),
              invoke: {
                src: "switchVariant",
                input: ({ context }) => ({
                  journey: context.journey,
                  at: context.at,
                  variant: variantOf(context),
                }),
              },
              on: {
                switched: {
                  target: "ready",
                  actions: assign({ entered: ({ context }) => context.opening }),
                },
              },
            },
            ready: {
              always: { guard: "variantStale", target: "switching" },
              invoke: {
                src: "keep",
                input: ({ context }) => ({ journey: context.journey, at: context.at }),
              },
            },
          },
        },
      },
    },
    panel: {
      initial: "starting",
      states: {
        starting: {
          always: [
            { guard: ({ context }) => context.panel, target: "shown" },
            { target: "hidden" },
          ],
        },
        hidden: {
          on: {
            panel: {
              guard: ({ event }) => event.shown !== false,
              target: "shown",
              actions: assign({
                panel: true,
                cursor: ({ context }) => context.at,
                row: undefined,
              }),
            },
          },
        },
        shown: {
          on: {
            // The panel comes back with the tree folded, so it shows the step as it was.
            panel: {
              guard: ({ event }) => event.shown !== true,
              target: "hidden",
              actions: assign({ panel: false, tree: false }),
            },
            tree: {
              actions: assign({ tree: ({ context, event }) => event.open ?? !context.tree }),
            },
            row: { actions: assign({ row: ({ event }) => event.id }) },
            fold: {
              actions: assign({
                folds: ({ context, event }) => ({ ...context.folds, [event.id]: event.open }),
              }),
            },
            cursor: {
              actions: assign({
                cursor: ({ context, event }) => clamp(context, context.cursor + event.by),
                row: undefined,
              }),
            },
            // As H and L on the page, past the settled steps.
            cursorOpen: {
              actions: assign({
                cursor: ({ context, event }) => openStepBy(context, event.by, context.cursor),
                row: undefined,
              }),
            },
          },
        },
      },
    },
    layer: {
      initial: "none",
      states: {
        none: {},
        notes: {},
        variants: {},
        people: {},
        help: {},
        go: {},
        journeys: {},
        here: {},
        pinned: {
          exit: assign({
            notes: ({ context }) => dropEmpty(context),
            opened: undefined,
          }),
        },
      },
      on: {
        open: [
          { target: ".notes", guard: ({ event }) => event.layer === "notes" },
          { target: ".variants", guard: ({ event }) => event.layer === "variants" },
          { target: ".people", guard: ({ event }) => event.layer === "people" },
          { target: ".help", guard: ({ event }) => event.layer === "help" },
          { target: ".go", guard: ({ event }) => event.layer === "go" },
          { target: ".journeys", guard: ({ event }) => event.layer === "journeys" },
          { target: ".here", guard: ({ event }) => event.layer === "here" },
        ],
        close: ".none",
        escape: ".none",
        pin: {
          target: ".pinned",
          reenter: true,
          // A pointed note shows with the tools, as it is the reviewer's own words.
          actions: assign({ opened: ({ event }) => event.id, preview: false }),
        },
        point: {
          // With no step and no page, a note has no place to go.
          guard: ({ context }) => (noteStepOf(context) ?? "") !== "",
          target: ".pinned",
          reenter: true,
          actions: assign({
            notes: ({ context, event }) =>
              withNote(context, event.id, () =>
                blankNote(event.id, noteStepOf(context) ?? "", event.pin),
              ),
            opened: ({ event }) => event.id,
            preview: false,
          }),
        },
        go: ".none",
        jump: ".none",
        choose: ".none",
        leave: ".none",
      },
    },
    agent: {
      initial: "idle",
      states: {
        idle: { always: { guard: "readsReplies", target: "polling" } },
        polling: {
          invoke: { src: "poll" },
          always: { guard: "readsNoReplies", target: "idle" },
        },
      },
    },
  },
});

export type SessionActor = ActorRefFrom<typeof sessionMachine>;
