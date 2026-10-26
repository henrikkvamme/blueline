import type { Message, SentPin } from "./note";

/*
 * A take-back: the reviewer cancels a message, or a finished review, after it went. Blueline
 * does not stop the agent, as it may work on other things. It writes one follow-up in the same
 * chat, a note line as any message, whose words tell the agent to ignore the message and wait.
 * The follow-up's `withdraws` names what it takes back. Each message, and each finish, is
 * taken back once; a follow-up has no take-back of its own.
 */

/** How many characters of the message the follow-up quotes. */
const QUOTE = 60;

/** What the agent does after a take-back, the same for a message and a finish. */
const THEN =
  "If you started work on it, stop. Do not undo the changes you made, unless I ask. " +
  "Wait for my next message. Reply to confirm.";

const pad = (n: number) => String(n).padStart(2, "0");

/** The time of day of `at`, as the reviewer's clock reads it: 14:32. */
const timeOf = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The first words, on one line, cut to about QUOTE characters. */
function quoteOf(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= QUOTE ? line : `${line.slice(0, QUOTE - 1).trimEnd()}…`;
}

/** The follow-up's words: for a message, its first words and its time, or its first
 * annotation's words when it has none; for a finished review, its journey's title. */
export function takeBackWords(
  what:
    | {
        readonly text: string;
        readonly pins: readonly Pick<SentPin, "text">[];
        readonly at: number;
      }
    | { readonly journey: string },
): string {
  if ("journey" in what)
    return `Take back my finished review of "${what.journey}". Ignore it and its verdicts. ${THEN}`;
  const quote = quoteOf(what.text !== "" ? what.text : (what.pins[0]?.text ?? ""));
  const words = quote === "" ? "" : ` ("${quote}")`;
  return `Take back my message of ${timeOf(what.at)}${words}. Ignore it. ${THEN}`;
}

/** Whether the message is a follow-up that Blueline wrote. */
export const isFollowUp = (m: Message) => m.withdraws !== undefined;

/** The follow-up that takes back the reviewer's message sent at `at`, or with no `at`, the
 * chat's finish. */
export const followUpOf = (thread: readonly Message[], at: number | undefined) =>
  thread.find((m) => m.withdraws !== undefined && m.withdraws.at === at);

/** Whether the message sent at `at`, or with no `at` the finish, is taken back. */
export const takenBack = (thread: readonly Message[], at: number | undefined) =>
  followUpOf(thread, at) !== undefined;

/** Whether the reviewer can take back their message sent at `at`, or with no `at` the finish:
 * it is not taken back yet, and a message is the reviewer's own and no follow-up. */
export function canTakeBack(thread: readonly Message[], at: number | undefined): boolean {
  if (takenBack(thread, at)) return false;
  if (at === undefined) return true;
  const m = thread.find((x) => x.by === "you" && x.at === at);
  return m !== undefined && !isFollowUp(m);
}
