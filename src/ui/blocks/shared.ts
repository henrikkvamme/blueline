import type { Block } from "../../notes/blocks";
import type { Message, Note } from "../../notes/note";
import { now, useTools } from "../session";

export type Of<K extends Block["kind"]> = { readonly block: Extract<Block, { kind: K }> };

export type Props<K extends Block["kind"]> = Of<K> & {
  readonly note: Note;
  /** The messages after the one with the block, as the reviewer's answer is among them. */
  readonly after: readonly Message[];
};

/** The small heading over a block. */
export const label = "text-[11px] font-medium text-dt-muted";

/** The reviewer's first message after the block: their answer to it, if any. */
export const answerOf = (after: readonly Message[]) => after.find((m) => m.by === "you")?.text;

/** Sends words as the reviewer's message on the note, as the composer does. */
export const useSend = (note: Note) => {
  const { actor } = useTools();
  return (text: string) => {
    if (text.trim() !== "")
      actor.send({ type: "send", id: note.id, step: note.step, at: now(), text });
  };
};
