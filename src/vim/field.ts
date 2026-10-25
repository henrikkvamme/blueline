// The bridge between the vim engine (engine.ts) and one <input> or <textarea>. It reads the field
// into a `Doc` and applies a key's `Result` through the browser's own editing (execCommand), so the
// field's undo has each change and React hears it as typing. Normal mode's block cursor is a
// selection of one character, and visual mode's selection is the field's own.
import { clampNormal, selectionOf, type Doc, type Result, type VimState } from "./engine";

/** A text field vim can edit. */
export type VimField = HTMLInputElement | HTMLTextAreaElement;

/** Where vim put the cursor last, and the selection that showed it: a visual selection does not
 *  say which of its ends the cursor is. */
export type Placed = { cursor: number; from: number; to: number };

const read = (el: VimField) => ({
  text: el.value,
  from: el.selectionStart ?? 0,
  to: el.selectionEnd ?? 0,
});

/** The field as the engine reads it. The cursor is where vim put it, unless the selection moved
 *  since (a click, an arrow key). */
export function docOf(el: VimField, state: VimState, placed: Placed | undefined): Doc {
  const now = read(el);
  const cursor =
    placed && placed.from === now.from && placed.to === now.to
      ? placed.cursor
      : state.mode === "insert"
        ? now.to
        : now.from;
  return { text: now.text, cursor };
}

/** Selects what shows `state` at `cursor` in the field: a caret, a block or a selection. */
export function show(el: VimField, state: VimState, cursor: number): Placed {
  const text = el.value;
  const at = Math.min(cursor, text.length);
  const [from, to] = selectionOf(state, { text, cursor: at });
  el.setSelectionRange(from, to);
  return { cursor: at, from, to };
}

/** Applies a handled key's change or undo to the field, then shows the new state. */
export function apply(el: VimField, r: Result): Placed {
  let at = r.cursor;
  if (r.history) {
    // The field's own undo and redo, so they step through what was typed as well as vim's edits.
    document.execCommand(r.history);
    at = read(el).from;
  } else if (r.edit) {
    // One change, made as typing would make it, so the field's undo and its listeners have it.
    el.setSelectionRange(r.edit.from, r.edit.to);
    if (r.edit.insert) document.execCommand("insertText", false, r.edit.insert);
    else if (r.edit.from !== r.edit.to) document.execCommand("delete");
  }
  return show(el, r.state, at);
}

/** The state after a press in normal or visual mode: a press puts the block cursor where it
 *  lands, and a drag selects in visual mode. */
export function afterPointer(el: VimField, state: VimState): { state: VimState; placed: Placed } {
  const now = read(el);
  const dragged = now.to > now.from;
  const next: VimState = dragged
    ? { ...state, mode: "visual", anchor: now.from, pending: "" }
    : { ...state, mode: "normal", pending: "" };
  // A press after a line's end puts the block on its last character, as in nvim.
  const at = dragged ? now.to - 1 : clampNormal(now.text, now.from);
  return { state: next, placed: show(el, next, at) };
}
