import { blankNote, isWithAgent, type Note } from "./note";

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
