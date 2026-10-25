/*
 * The composer's slash commands: a / at the start of an empty note shows them, and Enter
 * runs the first that matches what follows it, in place of sending.
 */

export const SLASH = [
  { name: "clear", does: "Empty the chat and start it again." },
  { name: "settle", does: "Say the step is right, and settle it." },
] as const;

export type Slash = (typeof SLASH)[number];

/** The commands the draft asks for: all of them for a lone /, none for words. */
export function slashMatches(draft: string): readonly Slash[] {
  const typed = /^\/([a-z]*)$/.exec(draft.trim())?.[1];
  return typed === undefined ? [] : SLASH.filter((c) => c.name.startsWith(typed));
}
