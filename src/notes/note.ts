import { Schema } from "effect";
import { assign, setup, transition } from "xstate";
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
});
export type Message = typeof MessageSchema.Type;

/** One of the agent's replies, as the status file has it. */
export interface AgentReply {
  readonly text: string;
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
    }
  /** The dev server did not take it: the words go back to the draft. */
  | { readonly type: "failed" }
  /** The agent works on the note, and shows `progress` while it does. */
  | { readonly type: "working"; readonly progress?: Message["blocks"] }
  | {
      readonly type: "reply";
      readonly at: number;
      readonly replies: readonly AgentReply[];
      readonly settled: boolean;
    }
  | { readonly type: "settle" }
  | { readonly type: "reopen" }
  | { readonly type: "read" };

type Context = Omit<Note, "state">;

const words = (context: Context, event: NoteEvent) =>
  (event.type === "send" ? (event.text ?? context.draft) : "").trim();

/** The screenshots a send takes: the draft's, unless it sends other words. */
const imagesOf = (context: Context, event: NoteEvent) =>
  event.type === "send" && event.text === undefined ? (context.images ?? []) : [];

const agentSaid = (context: Context) => context.thread.some((m) => m.by === "agent");

const lifecycle = setup({
  types: { context: {} as Context, events: {} as NoteEvent, input: {} as Context },
  guards: {
    hasWords: ({ context, event }) =>
      words(context, event) !== "" ||
      imagesOf(context, event).length > 0 ||
      (event.type === "send" && (event.pins?.length ?? 0) > 0),
    hasReplies: ({ event }) => event.type === "reply" && event.replies.length > 0,
    settlesAfterReply: ({ context, event }) =>
      event.type === "reply" && event.settled && (event.replies.length > 0 || agentSaid(context)),
    agentSaid: ({ context }) => agentSaid(context),
  },
  actions: {
    write: assign(({ context, event }) =>
      event.type === "write" ? { draft: event.draft, images: event.images ?? context.images } : {},
    ),
    send: assign(({ context, event }) => {
      if (event.type !== "send") return {};
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
          },
        ],
        draft: event.text === undefined ? "" : context.draft,
        images: event.text === undefined ? undefined : context.images,
        unread: false,
      };
    }),
    takeBack: assign(({ context }) => {
      const last = context.thread.at(-1);
      if (last?.by !== "you") return {};
      return { thread: context.thread.slice(0, -1), draft: last.text, images: last.images };
    }),
    addReplies: assign(({ context, event }) => {
      if (event.type !== "reply") return {};
      return {
        thread: [
          ...context.thread,
          ...event.replies.map((r) => ({
            by: "agent" as const,
            text: r.text,
            at: event.at,
            variant: r.variant,
            ...(r.blocks === undefined ? {} : { blocks: r.blocks }),
          })),
        ],
        unread: event.replies.length > 0 ? true : context.unread,
      };
    }),
    progress: assign(({ event }) => (event.type === "working" ? { progress: event.progress } : {})),
    endProgress: assign({ progress: undefined }),
    settledByYou: assign({ settledBy: "you" as const, unread: false }),
    settledByAgent: assign({ settledBy: "agent" as const }),
    unsettle: assign({ settledBy: undefined }),
    read: assign({ unread: false }),
  },
}).createMachine({
  id: "note",
  context: ({ input }) => input,
  initial: "new",
  on: { write: { actions: "write" }, read: { actions: "read" } },
  states: {
    new: { on: { send: { guard: "hasWords", target: "waiting", actions: "send" } } },
    waiting: {
      on: {
        send: { guard: "hasWords", target: "waiting", actions: "send" },
        failed: [
          { guard: "agentSaid", target: "replied", actions: "takeBack" },
          { target: "new", actions: "takeBack" },
        ],
        working: { target: "working", actions: "progress" },
        settle: { target: "settled", actions: "settledByYou" },
        reply: [
          {
            guard: "settlesAfterReply",
            target: "settled",
            actions: ["addReplies", "settledByAgent"],
          },
          { guard: "hasReplies", target: "replied", actions: "addReplies" },
        ],
      },
    },
    working: {
      // The progress is for the work: a reply, a settle or a new message ends it.
      exit: "endProgress",
      on: {
        working: { actions: "progress" },
        send: { guard: "hasWords", target: "waiting", actions: "send" },
        settle: { target: "settled", actions: "settledByYou" },
        reply: [
          {
            guard: "settlesAfterReply",
            target: "settled",
            actions: ["addReplies", "settledByAgent"],
          },
          { guard: "hasReplies", target: "replied", actions: "addReplies" },
        ],
      },
    },
    replied: {
      on: {
        send: { guard: "hasWords", target: "waiting", actions: "send" },
        settle: { target: "settled", actions: "settledByYou" },
        reply: [
          {
            guard: "settlesAfterReply",
            target: "settled",
            actions: ["addReplies", "settledByAgent"],
          },
          { guard: "hasReplies", target: "replied", actions: "addReplies" },
        ],
      },
    },
    settled: {
      on: {
        // The agent may still answer a settled note: it stays settled, and the answer shows.
        reply: { guard: "hasReplies", actions: "addReplies" },
        send: { guard: "hasWords", target: "waiting", actions: ["unsettle", "send"] },
        reopen: [
          { guard: "agentSaid", target: "replied", actions: "unsettle" },
          { target: "new", actions: "unsettle" },
        ],
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
    .filter((m) => m.by === "you")
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
