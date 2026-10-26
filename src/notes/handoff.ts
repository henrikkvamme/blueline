import { blankNote, isWithAgent, type Note } from "./note";
import { takenBack } from "./take-back";

/*
 * The hand-off: Finish sends the review to the agent, and the panel then shows what the agent
 * does with it. It is a note to the agent with no words of its own, so the replies, the plan
 * and the reload work as for any note. Finish writes the last settle line with the hand-off's
 * `id`, and the agent answers the review on that ID: `working` with its plan, then `replied`.
 * Each Finish has its own hand-off, so an answer to an earlier pass never shows on a new one.
 */

const PREFIX = "finish:";

/** The hand-off's step: the journey that the review finished. */
export const handoffStep = (journey: string) => `${PREFIX}${journey}`;

/** The hand-off's ID, by the journey and the time of the Finish, in ms. */
export const handoffId = (journey: string, at: number) => `finish-${journey}-${String(at)}`;

/** The journey of a hand-off's step; undefined for another note. */
export const handoffJourney = (step: string) =>
  step.startsWith(PREFIX) ? step.slice(PREFIX.length) : undefined;

/** Whether the note is a hand-off. */
export const isHandoff = (n: Note) => handoffJourney(n.step) !== undefined;

/** A new hand-off: sent, and waiting for the agent. */
export const newHandoff = (journey: string, at: number): Note => ({
  ...blankNote(handoffId(journey, at), handoffStep(journey)),
  state: "waiting",
});

/** The journey's newest hand-off, if a Finish made one. */
export const handoffOf = (notes: readonly Note[], journey: string): Note | undefined =>
  notes.filter((n) => n.step === handoffStep(journey)).at(-1);

/** Whether the hand-off still needs the reviewer's eye: the agent has not answered yet, or its
 * answer is not read. */
export const isLive = (n: Note) => isWithAgent(n) || n.unread;

/** Where a finished review is with the agent, as its journey's row in the tree says it. */
export type HandoffStatus =
  | { readonly kind: "sent" }
  /** With the item of its plan that it is on, when it shows a plan. */
  | { readonly kind: "working"; readonly doing?: string }
  /** With the first line of its newest reply. */
  | { readonly kind: "replied"; readonly reply: string }
  /** The reviewer took the finish back: it stays so, also once the agent confirms. */
  | { readonly kind: "taken" };

export function handoffStatus(n: Note): HandoffStatus {
  if (takenBack(n.thread, undefined)) return { kind: "taken" };
  if (n.state === "working") {
    const items = (n.progress ?? []).flatMap((b) => (b.kind === "plan" ? b.items : []));
    const doing = (items.find((i) => i.state === "doing") ?? items.find((i) => i.state === "todo"))
      ?.text;
    return doing === undefined ? { kind: "working" } : { kind: "working", doing };
  }
  const reply = n.thread.filter((m) => m.by === "agent").at(-1);
  if (reply !== undefined) return { kind: "replied", reply: reply.text.split("\n")[0] ?? "" };
  return { kind: "sent" };
}
