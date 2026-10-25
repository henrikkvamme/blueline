/*
 * A screenshot named in the words of a note. A paste into words already written puts a token,
 * `[Screenshot 1]`, at the cursor; the composer and the thread show it as a chip. The number is
 * the screenshot's place in the note's `images`, so the agent reads the words and the list as
 * one. The space in the token is a no-break space: the token never breaks over two lines, so a
 * chip drawn over it keeps the field's caret where it is.
 *
 * The rule for removal: a chip is only a reference. Deleting its words keeps the screenshot.
 * Removing the screenshot removes its chips, and the screenshots after it move up one number.
 */

/** The token for screenshot `number`, counted from 1. */
export const shotToken = (number: number) => `[Screenshot ${String(number)}]`;

const TOKEN = /\[Screenshot (\d+)\]/g;

/** A piece of a note's words: plain text, or a chip for screenshot `number`. */
export type Part =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "shot"; readonly text: string; readonly number: number };

type Found = { readonly from: number; readonly to: number; readonly number: number };

function tokensIn(text: string, count: number): readonly Found[] {
  return [...text.matchAll(TOKEN)].flatMap((m) => {
    const number = Number(m[1]);
    // A token for a screenshot the note does not have is plain text.
    if (number < 1 || number > count) return [];
    return [{ from: m.index, to: m.index + m[0].length, number }];
  });
}

/** The words as text and chips. `count` is how many screenshots the note has. */
export function partsOf(text: string, count: number): readonly Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const token of tokensIn(text, count)) {
    if (token.from > at) parts.push({ kind: "text", text: text.slice(at, token.from) });
    parts.push({ kind: "shot", text: text.slice(token.from, token.to), number: token.number });
    at = token.to;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}

/** Whether the words have a chip for one of the `count` screenshots. */
export const hasShots = (text: string, count: number) => tokensIn(text, count).length > 0;

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/**
 * Puts the tokens for `numbers` at `at`, with a space between them and the words. A place in a
 * token moves to its end. Gives the place the insert goes, the text to insert there, the words
 * after, and the cursor after the insert.
 */
export function insertShots(text: string, at: number, numbers: readonly number[]) {
  const clamped = Math.max(0, Math.min(at, text.length));
  const inside = tokensIn(text, Number.POSITIVE_INFINITY).find(
    (t) => t.from < clamped && clamped < t.to,
  );
  const place = inside?.to ?? clamped;
  const before = place > 0 && !isSpace(text[place - 1]) ? " " : "";
  const after = place === text.length || !isSpace(text[place]) ? " " : "";
  const insert = `${before}${numbers.map(shotToken).join(" ")}${after}`;
  return {
    place,
    insert,
    text: text.slice(0, place) + insert + text.slice(place),
    cursor: place + insert.length,
  };
}

/**
 * The words after screenshot `number` is removed: its tokens go, with one space beside each,
 * and the tokens after it move up one number.
 */
export function removeShot(text: string, number: number): string {
  const removed = text.replace(
    new RegExp(`( ?)\\[Screenshot\\u00a0${String(number)}\\]( ?)`, "g"),
    (_, left: string, right: string, offset: number, whole: string) => {
      const end = offset + left.length + shotToken(number).length + right.length;
      // Between two words one space stays; at the start or the end of the words none does.
      return left !== "" && right !== "" && offset > 0 && end < whole.length ? " " : "";
    },
  );
  return removed.replace(TOKEN, (token, n: string) =>
    Number(n) > number ? shotToken(Number(n) - 1) : token,
  );
}

/** The token that ends at `cursor` (`"before"`) or starts there (`"after"`), if one does. */
export function shotAt(text: string, cursor: number, side: "before" | "after") {
  return tokensIn(text, Number.POSITIVE_INFINITY).find((t) =>
    side === "before" ? t.to === cursor : t.from === cursor,
  );
}
