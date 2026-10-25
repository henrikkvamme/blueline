import { Option, Schema } from "effect";
import { blankNote, isKept, type Note, type SentPin } from "../notes/note";
import { KeptSchema, START, type Kept } from "../session/state";

/*
 * The review, kept in the browser's storage. Each field is read on its own, so a field an
 * older version kept differently, or does not have, takes its start value and the rest
 * stay.
 */

/** The pointed notes sent before the chat held them: each had a thread of its own, and its
 * messages went with a message of its step's chat, at the same time. */
const isLegacySent = (n: Note) => n.pin !== undefined && n.thread.length > 0;

/**
 * The notes as they are now. A pointed note sent before had a thread of its own: its words
 * and screenshots go into the message of its step's chat that sent it, found by the time of
 * the send, as the chat has them now. Such a note goes, and what the reviewer wrote after
 * the send waits as a pointed note not sent. The agent's replies to it stay in the status
 * file: the chat reads that file by count, so they do not join it.
 */
function inChats(notes: readonly Note[]): readonly Note[] {
  const sent = notes.filter(isLegacySent);
  const pinsAt = (chat: Note, at: number): readonly SentPin[] =>
    sent.flatMap(({ id, step, pin, thread }) =>
      pin === undefined || step !== chat.step
        ? []
        : thread
            .filter((m) => m.by === "you" && m.at === at)
            .map((m) => ({
              id,
              pin,
              text: m.text,
              ...(m.images === undefined ? {} : { images: m.images }),
            })),
    );
  return notes.flatMap((n) => {
    if (isLegacySent(n)) {
      return isKept(n) ? [{ ...blankNote(n.id, n.step, n.pin, n.draft), images: n.images }] : [];
    }
    if (n.pin !== undefined || sent.length === 0) return [n];
    return [
      {
        ...n,
        thread: n.thread.map((m) => {
          const pins = m.by === "you" ? pinsAt(n, m.at) : [];
          return pins.length === 0 ? m : { ...m, pins: [...(m.pins ?? []), ...pins] };
        }),
      },
    ];
  });
}

const fields = KeptSchema.fields;

function field<A>(schema: Schema.Decoder<A>, value: unknown, start: A): A {
  return Option.getOrElse(Schema.decodeUnknownOption(schema)(value), () => start);
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

export function loadKept(key: string): Kept {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!isRecord(raw)) return START;
    return {
      journey: field(fields.journey, raw["journey"], START.journey),
      active: field(fields.active, raw["active"], START.active),
      at: field(fields.at, raw["at"], START.at),
      variants: field(fields.variants, raw["variants"], START.variants),
      feedback: field(fields.feedback, raw["feedback"], START.feedback),
      notes: inChats(field(fields.notes, raw["notes"], START.notes)),
      // The sidebar before the panel was closed by default, so its state is not the panel's.
      panel: field(fields.panel, raw["panel"], START.panel),
      design: field(fields.design, raw["design"], START.design),
      chat: field(fields.chat, raw["chat"], START.chat),
      folds: field(fields.folds, raw["folds"], START.folds),
    };
  } catch {
    return START;
  }
}

export function saveKept(key: string, kept: Kept) {
  localStorage.setItem(key, JSON.stringify(kept));
}

/** What a session keeps of its context. */
export const keptOf = (context: Kept): Kept => ({
  journey: context.journey,
  active: context.active,
  at: context.at,
  variants: context.variants,
  feedback: context.feedback,
  notes: context.notes,
  panel: context.panel,
  design: context.design,
  chat: context.chat,
  folds: context.folds,
});
