import {
  assign,
  emit,
  enqueueActions,
  fromCallback,
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
import { dropped, keptOn } from "../part/store";
import {
  openPlace,
  stepBy,
  type Entered,
  type Feedback,
  type Kept,
  type PartVerdicts,
  type Shape,
} from "./state";

/*
 * The review session as a state machine. Four regions run side by side:
 * - review: off, on the page, or on a step of a journey: entering it, switching its
 *   variant, or ready. The sidebar's selection says which: a step opens it, a page leaves it;
 *   on a step, the card's chat is the step's or the page's;
 * - sidebar: the journey at the side, closed or open;
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
  /** The sidebar's selected step. */
  readonly cursor: number;
  /** The sidebar's selected row when it is not a step, as a note or a journey: its id. */
  readonly row: string | undefined;
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
}

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
    }
  /** `by` steps on; with `open`, only the steps not settled count, as H and L go. */
  | { readonly type: "go"; readonly by: number; readonly open?: boolean | undefined }
  | { readonly type: "jump"; readonly at: number }
  /** Opens the step's page and setup again, and scrolls its part to the middle. */
  | { readonly type: "reset" }
  | { readonly type: "variant"; readonly by: number }
  | { readonly type: "showVariant"; readonly step: string; readonly label: string }
  | { readonly type: "sidebar" }
  /** Opens or closes the page's card, for notes on the page; with no `open`, toggles it. */
  | { readonly type: "page"; readonly open?: boolean | undefined }
  /** The page changed: its notes have their own place. */
  | { readonly type: "place"; readonly place: string }
  | { readonly type: "cursor"; readonly by: number }
  /** Selects a sidebar row that is not a step, by its id. */
  | { readonly type: "row"; readonly id: string }
  /** Opens or closes a sidebar row's children, by the row's fold key. */
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
    }
  | { readonly type: "noteEvent"; readonly id: string; readonly event: NoteEvent }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "failed"; readonly ids: readonly string[] }
  /** Empties the chat of the step or the page. */
  | { readonly type: "clear"; readonly step: string }
  /** A post is done, so it ends. */
  | { readonly type: "posted"; readonly child: string }
  | { readonly type: "replies"; readonly replies: Readonly<Record<string, Reply>> }
  | { readonly type: "listening"; readonly listened: readonly (string | null)[] | undefined }
  /** Settles the step and goes on to the next open one, or opens a settled step again. A
   * settle keeps the variant the step's part shows, as the one the agent keeps in the code. */
  | {
      readonly type: "settle";
      /** The step to settle, as one selected in the sidebar; the review's step when none. */
      readonly step?: number | undefined;
      readonly keep?: { readonly part: string; readonly variant: string } | undefined;
      /** When, in ms: the step's notes not sent yet go with the settle, as a message. */
      readonly at?: number | undefined;
    }
  /** Deletes a variant of a part on the step. */
  | { readonly type: "drop"; readonly part: string; readonly variant: string }
  | { readonly type: "design"; readonly design: string }
  /** The journeys again, as the page's review follows the parts on the page. */
  | { readonly type: "journeys"; readonly journeys: readonly Shape[] }
  | { readonly type: "entered" }
  | { readonly type: "switched" }
  | { readonly type: "undo" }
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
  | { readonly type: "undone"; readonly label: string; readonly redo: boolean }
  /** The tools hide, until the reviewer asks for them again. */
  | { readonly type: "previewing" }
  /** Nothing to undo or redo. */
  | { readonly type: "nothing"; readonly redo: boolean }
  /** The step has no variants to lift. */
  | { readonly type: "unvaried" };

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
  readonly session: Context;
  /** A post sent once this one is, in its order. */
  readonly next?: Post | undefined;
}

export interface EnterInput {
  readonly journey: string;
  readonly at: number;
  readonly variant: number;
  readonly fresh: boolean;
  readonly leaving: Entered | undefined;
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

/** Whether the page reads the agent's replies: while a note waits, and all through a walk,
 * as an agent may answer again a note it answered, or settle it. */
const readsReplies = (c: Context) => c.active || c.notes.some(isWithAgent);

const variantLabel = (c: Context, step: string) => {
  const shape = shapeOf(c)?.steps.find((s) => s.id === step);
  return shape?.variants[c.variants[step] ?? 0];
};

const NO_VERDICTS: PartVerdicts = { kept: [], dropped: [] };

/** The verdicts on the part on the current step. */
const verdictsOf = (c: Context, part: string, step = stepOf(c)?.id): PartVerdicts =>
  (step === undefined ? undefined : c.feedback[step]?.parts?.[part]) ?? NO_VERDICTS;

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

/** How many actions `u` can take back. */
const HISTORY = 50;

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
      return note(event.id, "Removed a note");
    case "noteEvent":
      return event.event.type === "settle"
        ? note(event.id, "Settled a note")
        : event.event.type === "reopen"
          ? note(event.id, "Reopened a note")
          : undefined;
    case "settle": {
      const step = stepOf(c, event.step ?? c.at);
      if (step === undefined) return undefined;
      return {
        label: c.feedback[step.id]?.settled === true ? "Opened the step again" : "Settled the step",
        notes: c.notes.filter((n) => n.step === step.id).map((n) => [n.id, n] as const),
        feedback: [[step.id, c.feedback[step.id]]],
        at: c.at,
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
    remember: assign(({ context, event }) => {
      const change = changeOf(context, event);
      return change === undefined
        ? {}
        : { past: [...context.past, change].slice(-HISTORY), future: [] };
    }),
    // A step opens with its own chat, and the sidebar on it.
    activate: assign({
      active: true,
      chat: "step" as const,
      preview: false,
      cursor: ({ context }) => context.at,
      row: undefined,
    }),
    deactivate: assign({
      active: false,
      row: undefined,
      entered: undefined,
      opening: undefined,
      preview: false,
    }),
    nextRun: assign({ run: ({ context }) => context.run + 1 }),
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
    opened: undefined,
    preview: false,
    listened: undefined,
    posts: 0,
    past: [],
    future: [],
  }),
  on: {
    listening: { actions: assign({ listened: ({ event }) => event.listened }) },
    journeys: { actions: assign({ journeys: ({ event }) => event.journeys }) },
    place: { actions: assign({ place: ({ event }) => event.place }) },
    page: { actions: assign({ page: ({ context, event }) => event.open ?? !context.page }) },
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
    undo: {
      actions: enqueueActions(({ context, enqueue }) => {
        const change = context.past.at(-1);
        if (change === undefined) {
          enqueue.emit({ type: "nothing", redo: false });
          return;
        }
        enqueue.assign({
          ...restore(context, change),
          past: context.past.slice(0, -1),
          future: [...context.future, inverseOf(context, change)],
        });
        if (change.at !== undefined && change.at !== context.at)
          enqueue.raise({ type: "jump", at: change.at });
        enqueue.emit({ type: "undone", label: change.label, redo: false });
      }),
    },
    redo: {
      actions: enqueueActions(({ context, enqueue }) => {
        const change = context.future.at(-1);
        if (change === undefined) {
          enqueue.emit({ type: "nothing", redo: true });
          return;
        }
        enqueue.assign({
          ...restore(context, change),
          future: context.future.slice(0, -1),
          past: [...context.past, inverseOf(context, change)],
        });
        if (change.at !== undefined && change.at !== context.at)
          enqueue.raise({ type: "jump", at: change.at });
        enqueue.emit({ type: "undone", label: change.label, redo: true });
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
        enqueue.assign({ notes, feedback });
        enqueue.assign({ posts: context.posts + 1 });
        enqueue.spawnChild("post", {
          id: `post-${context.posts}`,
          input: { kind: "note", ids, session: { ...context, notes, feedback } },
        });
      }),
    },
    settle: {
      actions: [
        "remember",
        enqueueActions(({ context, event, enqueue }) => {
          const at = event.step ?? context.at;
          const step = stepOf(context, at);
          if (step === undefined) return;
          const was: Feedback = context.feedback[step.id] ?? {};
          const settled = was.settled !== true;
          // The notes not sent yet go with the settle, so none is lost: the agent works on
          // them while the step stays settled.
          const message = settled
            ? sentOf(context, { id: stepNoteId(step.id), step: step.id, at: event.at ?? 0 })
            : undefined;
          // Settling settles the step's other notes, also one the agent works on. Opening the
          // step again opens the notes the reviewer settled.
          const notes = (message?.notes ?? context.notes).map((n) =>
            n.step !== step.id || message?.ids.includes(n.id) === true
              ? n
              : settled
                ? noteAfter(n, { type: "settle" })
                : n.settledBy === "you"
                  ? noteAfter(n, { type: "reopen" })
                  : n,
          );
          // The settle keeps the variant shown; opening the step again keeps none, as the
          // reviewer may settle on another.
          const parts =
            settled && event.keep !== undefined
              ? {
                  ...was.parts,
                  [event.keep.part]: keptOn(
                    verdictsOf(context, event.keep.part),
                    event.keep.variant,
                  ),
                }
              : !settled && was.parts !== undefined
                ? Object.fromEntries(
                    Object.entries(was.parts).map(([part, v]) => [part, { ...v, kept: [] }]),
                  )
                : was.parts;
          const feedback = {
            ...context.feedback,
            [step.id]: { ...was, settled, ...(parts === undefined ? {} : { parts }) },
          };
          enqueue.assign({ notes, feedback });
          if (context.opened !== undefined && !notes.some((n) => n.id === context.opened))
            enqueue.raise({ type: "close" });
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
          // The last open step settled: the sidebar opens on the review's end.
          const ids = shapeOf(context)?.steps.map((s) => s.id) ?? [];
          const done =
            openPlace(ids, context.feedback, context.at).open > 0 &&
            openPlace(ids, feedback, context.at).open === 0;
          if (done) {
            if (!context.sidebar) enqueue.raise({ type: "sidebar" });
            return;
          }
          // A settle goes on to the next open step, or back to one before when none is after,
          // from the page and from the sidebar alike: the walk and the selection go there.
          if (!settled) return;
          const after = stepBy(ids, feedback, at, 1);
          const next = after !== at ? after : stepBy(ids, feedback, at, -1);
          enqueue.assign({ cursor: next, row: undefined });
          if (next !== context.at) enqueue.raise({ type: "go", by: next - context.at });
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
            leave: { target: "off", actions: "deactivate" },
            start: {
              target: ".entering",
              reenter: true,
              actions: [
                assign({
                  journey: ({ event }) => event.journey,
                  at: ({ event }) => event.at,
                  cursor: ({ event }) => event.at,
                  row: undefined,
                  fresh: ({ event }) => event.fresh,
                  preview: false,
                  chat: "step" as const,
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
            entering: {
              entry: assign(({ context }) => ({
                leaving: context.opening,
                opening: {
                  journey: context.journey,
                  at: context.at,
                  variant: variantOf(context),
                  run: context.run,
                },
              })),
              invoke: {
                src: "enterStep",
                input: ({ context }) => ({
                  journey: context.journey,
                  at: context.at,
                  variant: variantOf(context),
                  fresh: context.fresh,
                  leaving: context.leaving,
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
    sidebar: {
      initial: "starting",
      states: {
        starting: {
          always: [
            { guard: ({ context }) => context.sidebar, target: "open" },
            { target: "closed" },
          ],
        },
        closed: {
          on: {
            sidebar: {
              target: "open",
              actions: assign({
                sidebar: true,
                cursor: ({ context }) => context.at,
                row: undefined,
              }),
            },
          },
        },
        open: {
          on: {
            sidebar: { target: "closed", actions: assign({ sidebar: false }) },
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
            // As h and l on the page, past the settled steps.
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
