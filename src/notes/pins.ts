import { stepNoteId } from "../session/machine";
import { isKept, type Note } from "./note";

/*
 * Where a pointed note goes. Enter in its card sends it at once, as a message with its pin.
 * While the chat of its step or page holds words not sent, it joins them instead, and goes
 * with that message, as the reviewer may write about it there.
 */

/** Whether a pointed note on `step` joins the words in the chat's field. */
export const joinsDraft = (notes: readonly Note[], step: string): boolean => {
  const chat = notes.find((n) => n.id === stepNoteId(step));
  return chat !== undefined && isKept(chat);
};
