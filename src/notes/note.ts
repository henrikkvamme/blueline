import { Schema, Struct } from "effect";
import { setup, transition, types } from "xstate";
import { BlockSchema } from "./blocks";

/*
 * A note: a comment and a question at once. Each step and each page has one chat with the
 * agent, a note of its own. A note pinned to an element the reviewer pointed at waits, and
 * goes into the chat's next message: it has no thread of its own, and the agent answers it
 * in the chat. Settling the step settles its chat, also while the agent works; the agent
 * settles one only when the reviewer said so.
 *
 * The lifecycle is a state machine, used through its pure transition: a note stays plain
 * data, so it is kept in storage as it is and survives a reload.
 */

/** A screenshot the reviewer pasted: its name on the dev server, and its file for the agent. */
export const ImageSchema = Schema.Struct({ name: Schema.String, file: Schema.String });
export type Image = typeof ImageSchema.Type;

const PinSchema = Schema.Struct({
  what: Schema.String,
  selector: Schema.String,
  /** A note on a variant of a part, written in the lift (part/variants.tsx), and not on the
   * page: the part's name, the variant's label and the state's name, none for the page's. */
  variant: Schema.optional(
    Schema.Struct({
      part: Schema.String,
      variant: Schema.String,
      state: Schema.optional(Schema.String),
    }),
  ),
});
export type Pin = typeof PinSchema.Type;

/** A pointed note as it went with a message: the agent answers it in the message's chat. */
const SentPinSchema = Schema.Struct({
  id: Schema.String,
  pin: PinSchema,
  text: Schema.String,
  images: Schema.optional(Schema.Array(ImageSchema)),
});
export type SentPin = typeof SentPinSchema.Type;

/** What a take-back takes back: a message, by its chat's ID and its time, or a finished
 * review, by its hand-off's ID. */
const WithdrawsSchema = Schema.Struct({ id: Schema.String, at: Schema.optional(Schema.Finite) });
export type Withdraws = typeof WithdrawsSchema.Type;

const MessageSchema = Schema.Struct({
  by: Schema.Literals(["you", "agent"]),
  text: Schema.String,
  at: Schema.Finite,
  /** The variant that showed when the reviewer wrote, or the one the agent made. */
  variant: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(ImageSchema)),
  /** What the agent shows besides its words (blocks.ts). */
  blocks: Schema.optional(Schema.Array(BlockSchema)),
  /** The pointed notes the reviewer sent with it. */
  pins: Schema.optional(Schema.Array(SentPinSchema)),
  /** A take-back (take-back.ts): Blueline wrote it, to tell the agent to ignore the message of
   * this chat sent at `at`, or with no `at`, the finished review of the hand-off `id`. */
  withdraws: Schema.optional(WithdrawsSchema),
});
export type Message = typeof MessageSchema.Type;

/** One of the agent's replies, as the status file has it. */
export interface AgentReply {
  readonly text: string;
  /** When the agent wrote it, in ms; none in a status file from before. */
  readonly at?: number | undefined;
  readonly variant?: string | undefined;
  readonly blocks?: Message["blocks"];
}

export const NOTE_STATES = ["new", "waiting", "working", "replied", "settled"] as const;
const NoteStateSchema = Schema.Literals(NOTE_STATES);
export type NoteState = typeof NoteStateSchema.Type;

export const NoteSchema = Schema.Struct({
  id: Schema.String,
  step: Schema.String,
  /** The element the reviewer pointed at: in words for the agent, and as a CSS path. */
  pin: Schema.optional(PinSchema),
  thread: Schema.Array(MessageSchema),
  /** What the reviewer wrote and has not sent. */
  draft: Schema.String,
  /** The screenshots pasted with the draft. */
  images: Schema.optional(Schema.Array(ImageSchema)),
  state: NoteStateSchema,
  /** Whether the agent's newest reply is new to the reviewer. */
  unread: Schema.Boolean,
  settledBy: Schema.optional(Schema.Literals(["you", "agent"])),
  /** How many of the agent's replies in the status file came before /clear. */
  skip: Schema.optional(Schema.Finite),
  /** What the agent shows while it works, as a plan, in place as it goes on (blocks.ts). */
  progress: Schema.optional(Schema.Array(BlockSchema)),
  /** Since when the agent works on it, in ms; none from an agent before 0.1.14. */
  workingSince: Schema.optional(Schema.Finite),
});
export type Note = typeof NoteSchema.Type;

export type NoteEvent =
  | {
      readonly type: "write";
      readonly draft: string;
      readonly images?: readonly Image[] | undefined;
    }
  /** Sends the draft, or `text` and leaves the draft. */
  | {
      readonly type: "send";
      readonly at: number;
      readonly variant?: string | undefined;
      readonly text?: string | undefined;
      /** The pointed notes that go with it: a send with no words of its own still counts. */
      readonly pins?: readonly SentPin[] | undefined;
      /** What it takes back, for a take-back: Blueline's words, not the reviewer's. */
      readonly withdraws?: Withdraws | undefined;
    }
  /** The dev server did not take it: the words go back to the draft. */
  | { readonly type: "failed" }
  /** The agent works on the note, and shows `progress` while it does. */
  | {
      readonly type: "working";
      readonly progress?: Message["blocks"];
      readonly since?: number | undefined;
    }
  | {
      readonly type: "reply";
      /** The time of a reply that has none of its own. */
      readonly at: number;
      readonly replies: readonly AgentReply[];
      readonly settled: boolean;
    }
  /** Replies the agent wrote before the reviewer's newest message: they answer an earlier
   * one, so they take their place by time, and the newest message still waits. */
  | { readonly type: "earlier"; readonly replies: readonly AgentReply[] }
  | { readonly type: "settle" }
  | { readonly type: "reopen" }
  | { readonly type: "read" };

/** The note without its state, which the machine keeps as its own. */
const ContextSchema = NoteSchema.mapFields(Struct.omit(["state"]));
type Context = typeof ContextSchema.Type;

type Send = Extract<NoteEvent, { readonly type: "send" }>;
type Reply = Extract<NoteEvent, { readonly type: "reply" }>;

const words = (context: Context, event: NoteEvent) =>
  (event.type === "send" ? (event.text ?? context.draft) : "").trim();

/** The screenshots a send takes: the draft's, unless it sends other words. */
const imagesOf = (context: Context, event: NoteEvent) =>
  event.type === "send" && event.text === undefined ? (context.images ?? []) : [];

/** The thread with the agent's replies in it, each by its time; one with no time at `at`.
 * The sort is stable, so a reply comes after a message of the same time. */
const withReplies = (context: Context, replies: readonly AgentReply[], at: number) =>
  [
    ...context.thread,
    ...replies.map((r) => ({
      by: "agent" as const,
      text: r.text,
      at: r.at ?? at,
      variant: r.variant,
      ...(r.blocks === undefined ? {} : { blocks: r.blocks }),
    })),
  ].sort((a, b) => a.at - b.at);

const agentSaid = (context: Context) => context.thread.some((m) => m.by === "agent");

const hasWords = (context: Context, event: Send) =>
  words(context, event) !== "" ||
  imagesOf(context, event).length > 0 ||
  (event.pins?.length ?? 0) > 0;

const sent = (context: Context, event: Send) => {
  const images = imagesOf(context, event);
  return {
    thread: [
      ...context.thread,
      {
        by: "you" as const,
        text: words(context, event),
        at: event.at,
        variant: event.variant,
        ...(images.length === 0 ? {} : { images }),
        ...((event.pins?.length ?? 0) === 0 ? {} : { pins: event.pins }),
        ...(event.withdraws === undefined ? {} : { withdraws: event.withdraws }),
      },
    ],
    draft: event.text === undefined ? "" : context.draft,
    images: event.text === undefined ? undefined : context.images,
    unread: false,
  };
};

// A message the dev server did not take leaves the chat, and its words go back to the
// draft. A take-back's words are Blueline's: they only leave.
const takenBack = (context: Context) => {
  const last = context.thread.at(-1);
  if (last?.by !== "you") return {};
  const thread = context.thread.slice(0, -1);
  if (last.withdraws !== undefined) return { thread };
  return { thread, draft: last.text, images: last.images };
};

const withAnswer = (context: Context, event: Reply) => ({
  thread: withReplies(context, event.replies, event.at),
  unread: event.replies.length > 0 ? true : context.unread,
});

const progressOf = (event: Extract<NoteEvent, { readonly type: "working" }>) => ({
  progress: event.progress,
  workingSince: event.since,
});

const settledByYou = { settledBy: "you" as const, unread: false };

/** A send with words: the note waits for the agent. */
const send = ({ context, event }: { context: Context; event: Send }) =>
  hasWords(context, event)
    ? { target: "waiting" as const, context: sent(context, event) }
    : undefined;

/** A reply settles the note when the agent settled it after it said something, and the
 * note shows the reply when it has one. */
const reply = ({ context, event }: { context: Context; event: Reply }) =>
  event.settled && (event.replies.length > 0 || agentSaid(context))
    ? {
        target: "settled" as const,
        context: { ...withAnswer(context, event), settledBy: "agent" as const },
      }
    : event.replies.length > 0
      ? { target: "replied" as const, context: withAnswer(context, event) }
      : undefined;

const event = <T extends NoteEvent["type"]>() =>
  types<Omit<Extract<NoteEvent, { readonly type: T }>, "type">>();

const lifecycle = setup({
  schemas: {
    context: Schema.toStandardSchemaV1(ContextSchema),
    input: Schema.toStandardSchemaV1(ContextSchema),
    events: {
      write: event<"write">(),
      send: event<"send">(),
      failed: event<"failed">(),
      working: event<"working">(),
      reply: event<"reply">(),
      earlier: event<"earlier">(),
      settle: event<"settle">(),
      reopen: event<"reopen">(),
      read: event<"read">(),
    },
  },
}).createMachine({
  id: "note",
  context: ({ input }) => input,
  initial: "new",
  on: {
    write: ({ context, event }) => ({
      context: { draft: event.draft, images: event.images ?? context.images },
    }),
    read: () => ({ context: { unread: false } }),
    earlier: ({ context, event }) => ({
      context: { thread: withReplies(context, event.replies, 0) },
    }),
  },
  states: {
    new: { on: { send } },
    waiting: {
      on: {
        send,
        failed: ({ context }) => ({
          target: agentSaid(context) ? "replied" : "new",
          context: takenBack(context),
        }),
        working: ({ event }) => ({ target: "working", context: progressOf(event) }),
        settle: { target: "settled", context: settledByYou },
        reply,
      },
    },
    working: {
      // The progress is for the work: a reply, a settle or a new message ends it.
      exit: () => ({ context: { progress: undefined, workingSince: undefined } }),
      on: {
        working: ({ event }) => ({ context: progressOf(event) }),
        send,
        settle: { target: "settled", context: settledByYou },
        reply,
      },
    },
    replied: {
      on: {
        send,
        settle: { target: "settled", context: settledByYou },
        reply,
      },
    },
    settled: {
      on: {
        // The agent may still answer a settled note: it stays settled, and the answer shows.
        reply: ({ context, event }) =>
          event.replies.length > 0 ? { context: withAnswer(context, event) } : undefined,
        send: (args) => {
          const next = send(args);
          return next === undefined
            ? undefined
            : { ...next, context: { ...next.context, settledBy: undefined } };
        },
        reopen: ({ context }) => ({
          target: agentSaid(context) ? "replied" : "new",
          context: { settledBy: undefined },
        }),
      },
    },
  },
});

export const noteMachine = lifecycle;

const isState = (value: unknown): value is NoteState =>
  typeof value === "string" && NOTE_STATES.some((s) => s === value);

/** The note after `event`. An event the note's state does not take leaves it as it was. */
export function noteAfter(note: Note, event: NoteEvent): Note {
  const { state, ...context } = note;
  const snapshot = lifecycle.resolveState({ value: state, context });
  const [next] = transition(lifecycle, snapshot, event);
  return { ...next.context, state: isState(next.value) ? next.value : state };
}

/** A note with nothing sent. */
export const blankNote = (id: string, step: string, pin?: Pin, draft = ""): Note => ({
  id,
  step,
  ...(pin === undefined ? {} : { pin }),
  thread: [],
  draft,
  state: "new",
  unread: false,
});

/** Whether Send would send the note: it has words or screenshots not sent. */
/** What the reviewer sent in these notes, on these steps, as the finish counts it: each
 * message with words, and each annotation (a pin sent with a message). */
export const sentCount = (notes: readonly Note[], steps: ReadonlySet<string>) =>
  notes
    .filter((n) => steps.has(n.step))
    .flatMap((n) => n.thread)
    .filter((m) => m.by === "you" && m.withdraws === undefined)
    .reduce((count, m) => count + (m.pins?.length ?? 0) + (m.text.trim() === "" ? 0 : 1), 0);

export const isKept = (n: Note) => n.draft.trim() !== "" || (n.images?.length ?? 0) > 0;

/** Whether the note waits for the agent. */
export const isWithAgent = (n: Note) => n.state === "waiting" || n.state === "working";

/** Whether the note waits for the reviewer: the agent answered. */
export const needsYou = (n: Note) => n.state === "replied";

/** The chat after /clear: empty, as a new one. The agent's replies so far are in the status
 * file still, so the chat skips them. */
export function clearedNote(n: Note): Note {
  const replies = n.thread.filter((m) => m.by === "agent").length;
  return {
    ...n,
    thread: [],
    draft: "",
    images: undefined,
    state: "new",
    unread: false,
    settledBy: undefined,
    progress: undefined,
    skip: (n.skip ?? 0) + replies,
  };
}

/** The pointed note a sent one was, not sent again: it waits as before. */
export const unsentPin = (step: string, p: SentPin): Note => ({
  ...blankNote(p.id, step, p.pin, p.text),
  ...(p.images === undefined ? {} : { images: p.images }),
});
