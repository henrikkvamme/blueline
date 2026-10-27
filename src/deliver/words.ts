/*
 * The fixed words that come with the reviewer's lines when Blueline gives them to an agent
 * outside a tool call: in a hook (bin/hook.ts), in an idle session's wake (bin/wait.ts), and
 * in the prompt of a session that Blueline starts or wakes (bin/deliver.ts). They hold no
 * counts, times or state, so each time they are the same words (ADR 0005, cache rules).
 */

/** The line before the reviewer's lines in a hook's output and a wake. */
export const HOOK_HEADER =
  "Blueline: the reviewer's new lines, each after a tag that says when it was sent. Answer each line with an id by reply, on its id: first with state working and your plan, then with state replied.";
