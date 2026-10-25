// Vim editing for a dev tool's text fields, as a plain function: one key in, what it does out. It
// knows only a text and a cursor, so it needs no DOM; field.ts reads a field into a `Doc` and
// applies the `Result` through the browser's own editing, which keeps the field's undo and React's
// view of it in step. Ported from Ljore's dashboard (lib/vim.ts).
//
// It covers the vim most people type without thinking: insert, normal, visual and visual line
// mode; counts; the motions h j k l w W b B e E 0 ^ $ gg G f F t T ; , and %; the operators d, c
// and y with any motion or a text object (iw aw iW aW i" a" i' a' i` a` i( a( ib i[ a[ i{ a{ iB
// i< a<), doubled for whole lines; and x X s S C D Y r J ~ p P u Ctrl+R i a I A o O v V.

/** The editing mode. Insert types as a plain field does. */
export type Mode = "insert" | "normal" | "visual" | "visual-line";

/** What was yanked or deleted last, and whether it was whole lines. */
export type Register = { text: string; linewise: boolean };

type FindKey = "f" | "F" | "t" | "T";

/** What the engine keeps between keys. */
export type VimState = {
  mode: Mode;
  /** The keys of a command not complete yet ("d", "2f", "ci"). */
  pending: string;
  register: Register;
  /** In visual mode: where the selection began. The cursor is its other end. */
  anchor: number;
  /** The column j and k keep to, when a shorter line moved the cursor left of it. */
  column?: number | undefined;
  /** The last f, F, t or T, for ; and ,. */
  find?: { key: FindKey; char: string } | undefined;
};

/** A field's text and its cursor: the index of the character the block cursor is on. */
export type Doc = { text: string; cursor: number };

/** One key, as `KeyboardEvent` gives it. */
export type Key = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };

/** One change to the text: the characters from `from` to `to` become `insert`. `linewise` when
 *  it deletes whole lines. */
export type Edit = { from: number; to: number; insert: string; linewise?: boolean };

/** What one key does. */
export type Result = {
  /** The key was vim's: the field must not see it. False leaves it to the field and the page. */
  handled: boolean;
  state: VimState;
  /** The cursor after the key (and after `edit`). */
  cursor: number;
  edit?: Edit;
  /** The field's own undo or redo runs. */
  history?: "undo" | "redo";
};

export const initialVim = (mode: Mode = "insert"): VimState => ({
  mode,
  pending: "",
  register: { text: "", linewise: false },
  anchor: 0,
});

// ---- Text ----

/** The character at `i`, or "" past either end. */
const at = (t: string, i: number) => t.charAt(i);
const isBlank = (ch: string) => ch === " " || ch === "\t";

const lineStart = (t: string, i: number) => t.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (t: string, i: number) => {
  const n = t.indexOf("\n", i);
  return n < 0 ? t.length : n;
};
/** The last place the block cursor may sit on the line: its last character, or its start. */
const lastOnLine = (t: string, i: number) => Math.max(lineStart(t, i), lineEnd(t, i) - 1);
/** Where the block cursor sits for a place in the text: never past its line's last character. */
export const clampNormal = (t: string, i: number) => {
  const c = Math.max(0, Math.min(i, t.length));
  return Math.min(c, lastOnLine(t, c));
};
const firstNonBlank = (t: string, i: number) => {
  let c = lineStart(t, i);
  const end = lineEnd(t, i);
  while (c < end && isBlank(at(t, c))) c++;
  return c;
};

/** A character's class for w, b and e: 0 a space, 1 a word character, 2 anything else. With
 *  `big` (W, B, E) every non-space is one class. A line break is a space. */
function kind(ch: string, big: boolean) {
  if (ch === "" || /\s/.test(ch)) return 0;
  if (big) return 1;
  return /[\p{L}\p{N}_]/u.test(ch) ? 1 : 2;
}

function wordForward(t: string, i: number, big: boolean) {
  const n = t.length;
  if (i >= n) return n;
  const k = kind(at(t, i), big);
  let c = i;
  if (k !== 0) while (c < n && kind(at(t, c), big) === k) c++;
  // An empty line is a word of its own.
  while (c < n && kind(at(t, c), big) === 0) {
    if (at(t, c) === "\n" && c + 1 < n && at(t, c + 1) === "\n" && c + 1 > i) return c + 1;
    c++;
  }
  return c;
}

function wordBack(t: string, i: number, big: boolean) {
  let c = i - 1;
  while (c > 0 && kind(at(t, c), big) === 0) c--;
  if (c <= 0) return 0;
  const k = kind(at(t, c), big);
  while (c > 0 && kind(at(t, c - 1), big) === k) c--;
  return c;
}

function wordEnd(t: string, i: number, big: boolean) {
  const n = t.length;
  let c = i + 1;
  while (c < n && kind(at(t, c), big) === 0) c++;
  if (c >= n) return Math.max(0, n - 1);
  const k = kind(at(t, c), big);
  while (c + 1 < n && kind(at(t, c + 1), big) === k) c++;
  return c;
}

const PAIRS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ["(", ["(", ")"]],
  [")", ["(", ")"]],
  ["b", ["(", ")"]],
  ["[", ["[", "]"]],
  ["]", ["[", "]"]],
  ["{", ["{", "}"]],
  ["}", ["{", "}"]],
  ["B", ["{", "}"]],
  ["<", ["<", ">"]],
  [">", ["<", ">"]],
]);

/** The bracket that matches the one at or after the cursor on its line (%). */
function matchBracket(t: string, i: number) {
  const end = lineEnd(t, i);
  let c = i;
  while (c < end && !"()[]{}".includes(at(t, c))) c++;
  if (c >= end) return undefined;
  const pair = PAIRS.get(at(t, c));
  if (!pair) return undefined;
  const [open, close] = pair;
  const forward = at(t, c) === open;
  let depth = 0;
  for (let j = c; forward ? j < t.length : j >= 0; j += forward ? 1 : -1) {
    if (at(t, j) === open) depth += forward ? 1 : -1;
    else if (at(t, j) === close) depth += forward ? -1 : 1;
    if (depth === 0) return j;
  }
  return undefined;
}

/** The range of a text object around the cursor, end exclusive. */
function textObject(t: string, c: number, inner: boolean, obj: string) {
  if (obj === "w" || obj === "W") {
    const big = obj === "W";
    if (!t.length) return undefined;
    const pos = Math.min(c, t.length - 1);
    const k = kind(at(t, pos), big);
    let from = pos;
    let to = pos + 1;
    const same = (j: number) =>
      k === 0 ? isBlank(at(t, j)) : kind(at(t, j), big) === k && at(t, j) !== "\n";
    while (from > 0 && same(from - 1)) from--;
    while (to < t.length && same(to)) to++;
    if (!inner) {
      // aw takes the spaces after the word, else the ones before it.
      let after = to;
      while (after < t.length && isBlank(at(t, after))) after++;
      if (after > to && k !== 0) to = after;
      else while (from > lineStart(t, pos) && isBlank(at(t, from - 1))) from--;
    }
    return { from, to };
  }
  if (obj === '"' || obj === "'" || obj === "`") {
    const ls = lineStart(t, c);
    const le = lineEnd(t, c);
    const quotes: number[] = [];
    for (let j = ls; j < le; j++) if (at(t, j) === obj) quotes.push(j);
    for (let q = 0; q + 1 < quotes.length; q += 2) {
      const a = quotes[q];
      const b = quotes[q + 1];
      if (a === undefined || b === undefined) break;
      if (c <= b) {
        if (c < a && q > 0) break;
        return inner ? { from: a + 1, to: b } : { from: a, to: b + 1 };
      }
    }
    return undefined;
  }
  const pair = PAIRS.get(obj);
  if (!pair) return undefined;
  const [open, close] = pair;
  let depth = 0;
  let from = -1;
  for (let j = at(t, c) === close ? c - 1 : c; j >= 0; j--) {
    if (at(t, j) === close && j !== c) depth++;
    else if (at(t, j) === open) {
      if (depth === 0) {
        from = j;
        break;
      }
      depth--;
    }
  }
  if (from < 0) return undefined;
  depth = 0;
  for (let j = from + 1; j < t.length; j++) {
    if (at(t, j) === open) depth++;
    else if (at(t, j) === close) {
      if (depth === 0) return inner ? { from: from + 1, to: j } : { from, to: j + 1 };
      depth--;
    }
  }
  return undefined;
}

// ---- Motions ----

type Motion = {
  to: number;
  inclusive?: boolean;
  linewise?: boolean;
  column?: number;
  find?: VimState["find"];
};

const MOTION_KEYS = "hjklwWbBeE0^$G;,%";

const isFindKey = (key: string): key is FindKey =>
  key === "f" || key === "F" || key === "t" || key === "T";

/** The find that `,` runs: the last one, the other way. */
const reverseFind = (key: FindKey): FindKey =>
  key === "f" ? "F" : key === "F" ? "f" : key === "t" ? "T" : "t";

/** Where a motion takes the cursor `count` times. Undefined when it cannot move (an f with no
 *  match). `forOperator` lets l and $ reach the end of the line, as an operator needs. */
function motion(
  t: string,
  c: number,
  keys: string,
  count: number,
  s: VimState,
  forOperator: boolean,
): Motion | undefined {
  const key = keys.charAt(0);
  switch (key) {
    case "h":
      return { to: Math.max(lineStart(t, c), c - count) };
    case "l":
      return {
        to: Math.min(forOperator ? lineEnd(t, c) : lastOnLine(t, c), c + count),
      };
    case "0":
      return { to: lineStart(t, c) };
    case "^":
      return { to: firstNonBlank(t, c) };
    case "$": {
      let pos = c;
      for (let n = 1; n < count; n++) pos = Math.min(t.length, lineEnd(t, pos) + 1);
      return { to: forOperator ? lineEnd(t, pos) : lastOnLine(t, pos), inclusive: false };
    }
    case "j":
    case "k": {
      const column = s.column ?? c - lineStart(t, c);
      let pos = c;
      for (let n = 0; n < count; n++) {
        const next = key === "j" ? lineEnd(t, pos) + 1 : lineStart(t, pos) - 1;
        if (next < 0 || next > t.length) break;
        pos = next;
      }
      if (pos === c) return { to: c, linewise: true, column };
      const ls = lineStart(t, pos);
      return { to: Math.min(ls + column, lastOnLine(t, ls)), linewise: true, column };
    }
    case "w":
    case "W": {
      let pos = c;
      for (let n = 0; n < count; n++) pos = wordForward(t, pos, key === "W");
      // An operator stops at the end of its line, as dw on the last word of a line does.
      if (forOperator && pos > lineEnd(t, c) && lineEnd(t, c) > c) pos = lineEnd(t, c);
      return { to: forOperator ? pos : Math.min(pos, Math.max(0, t.length - 1)) };
    }
    case "b":
    case "B": {
      let pos = c;
      for (let n = 0; n < count; n++) pos = wordBack(t, pos, key === "B");
      return { to: pos };
    }
    case "e":
    case "E": {
      let pos = c;
      for (let n = 0; n < count; n++) pos = wordEnd(t, pos, key === "E");
      return { to: pos, inclusive: true };
    }
    case "G": {
      if (count > 1 || /^\d/.test(s.pending)) {
        let pos = 0;
        for (let n = 1; n < count; n++) {
          const next = lineEnd(t, pos) + 1;
          if (next > t.length) break;
          pos = next;
        }
        return { to: firstNonBlank(t, pos), linewise: true };
      }
      return { to: firstNonBlank(t, t.length), linewise: true };
    }
    case "g":
      return keys.charAt(1) === "g"
        ? {
            to: firstNonBlank(t, count > 1 ? lineAt(t, count - 1) : 0),
            linewise: true,
          }
        : undefined;
    case "%": {
      const to = matchBracket(t, c);
      return to === undefined ? undefined : { to, inclusive: true };
    }
    case "f":
    case "F":
    case "t":
    case "T":
    case ";":
    case ",": {
      const repeat = key === ";" || key === ",";
      const f = repeat
        ? s.find && {
            key: key === ";" ? s.find.key : reverseFind(s.find.key),
            char: s.find.char,
          }
        : isFindKey(key)
          ? { key, char: keys.charAt(1) }
          : undefined;
      if (!f) return undefined;
      const ls = lineStart(t, c);
      const le = lineEnd(t, c);
      const forward = f.key === "f" || f.key === "t";
      let pos = c;
      for (let n = 0; n < count; n++) {
        // A repeated t starts past the character it stopped before.
        let j = pos + (forward ? 1 : -1);
        if (repeat && (f.key === "t" || f.key === "T") && n === 0) j += forward ? 1 : -1;
        while (j >= ls && j < le && at(t, j) !== f.char) j += forward ? 1 : -1;
        if (j < ls || j >= le) return undefined;
        pos = j;
      }
      if (f.key === "t") pos -= 1;
      if (f.key === "T") pos += 1;
      const find = repeat ? s.find : f;
      return { to: pos, inclusive: forward, find };
    }
  }
  return undefined;
}

/** The start of line `n` (0 is the first), or of the last line. */
function lineAt(t: string, n: number) {
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const next = t.indexOf("\n", pos);
    if (next < 0) break;
    pos = next + 1;
  }
  return pos;
}

/** Whether `keys` (after any count) is a whole motion, the start of one, or neither. */
function motionShape(keys: string): "whole" | "more" | "no" {
  if (!keys) return "more";
  const k = keys.charAt(0);
  if (MOTION_KEYS.includes(k)) return keys.length === 1 ? "whole" : "no";
  if (k === "g") return keys.length === 1 ? "more" : keys === "gg" ? "whole" : "no";
  if ("fFtT".includes(k)) return keys.length === 1 ? "more" : keys.length === 2 ? "whole" : "no";
  return "no";
}

/** A count and the keys after it: "12dw" is 12 and "dw". "0" alone is a motion, not a count. */
function splitCount(keys: string): [number | undefined, string] {
  const digits = /^[1-9]\d*/.exec(keys)?.[0] ?? "";
  return [digits ? Number(digits) : undefined, keys.slice(digits.length)];
}

// ---- Keys ----

/** Keys that only change what the next key types. */
const MODIFIERS = new Set(["Shift", "Alt", "AltGraph", "Control", "Meta", "CapsLock"]);

type More = { edit?: Edit; history?: "undo" | "redo" };

const done = (s: VimState, cursor: number, more: More = {}): Result => ({
  handled: true,
  state: { ...s, pending: "" },
  cursor,
  ...more,
});

const toNormal = (s: VimState, t: string, c: number, more: More = {}): Result =>
  done({ ...s, mode: "normal", column: undefined }, clampNormal(t, c), more);

const toggleCase = (text: string) =>
  text
    .split("")
    .map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()))
    .join("");

/** An operator on a range: the edit, the register and where the cursor goes. */
function operate(
  s: VimState,
  t: string,
  op: string,
  from: number,
  to: number,
  linewise: boolean,
): Result {
  if (linewise) {
    const ls = lineStart(t, from);
    const le = lineEnd(t, Math.max(from, to));
    const text = t.slice(ls, le);
    const register = { text, linewise: true };
    if (op === "y") return done({ ...s, register, mode: "normal" }, clampNormal(t, from));
    if (op === "c") {
      // cc keeps the line's indent and the line itself.
      const indent = t.slice(ls, firstNonBlank(t, ls));
      return done({ ...s, register, mode: "insert" }, ls + indent.length, {
        edit: { from: ls, to: le, insert: indent },
      });
    }
    // d takes the lines and one line break with them.
    const [a, b] = le < t.length ? [ls, le + 1] : [Math.max(0, ls - 1), le];
    const rest = t.slice(0, a) + t.slice(b);
    return done({ ...s, register, mode: "normal" }, firstNonBlank(rest, Math.min(a, rest.length)), {
      edit: { from: a, to: b, insert: "", linewise: true },
    });
  }
  const text = t.slice(from, to);
  const register = { text, linewise: false };
  if (op === "y") return done({ ...s, register, mode: "normal" }, clampNormal(t, from));
  const edit = { from, to, insert: "" };
  if (op === "c") return done({ ...s, register, mode: "insert" }, from, { edit });
  const rest = t.slice(0, from) + t.slice(to);
  return done({ ...s, register, mode: "normal" }, clampNormal(rest, from), { edit });
}

/** Puts the register after (`p`) or before (`P`) the cursor, or in place of a selection. */
function put(s: VimState, t: string, c: number, after: boolean, count: number): Result {
  const r = s.register;
  if (!r.text && !r.linewise) return done(s, c);
  const many = Array.from({ length: count }, () => r.text);
  if (r.linewise) {
    const block = many.join("\n");
    if (after) {
      const le = lineEnd(t, c);
      return done(s, le + 1, { edit: { from: le, to: le, insert: `\n${block}` } });
    }
    const ls = lineStart(t, c);
    return done(s, ls, { edit: { from: ls, to: ls, insert: `${block}\n` } });
  }
  const text = many.join("");
  const pos = after && t.length && at(t, c) !== "\n" && c < t.length ? c + 1 : c;
  return done(s, pos + text.length - 1, { edit: { from: pos, to: pos, insert: text } });
}

/** One key in vim. */
export function vimKey(s: VimState, doc: Doc, k: Key): Result {
  const t = doc.text;
  const c = Math.max(0, Math.min(doc.cursor, t.length));
  const escape = k.key === "Escape" || (k.ctrlKey === true && k.key === "[");
  const pass: Result = { handled: false, state: s, cursor: c };

  if (s.mode === "insert") {
    if (!escape) return pass;
    // Esc leaves insert one place to the left, as vim does.
    return toNormal(s, t, c > lineStart(t, c) ? c - 1 : c);
  }

  if (escape) {
    if (s.mode === "visual" || s.mode === "visual-line") return toNormal(s, t, c);
    // A second Esc in normal mode is the page's (the dev tool closes or leaves the field).
    if (!s.pending) return pass;
    return done(s, c);
  }
  // A modifier going down on its own is the start of the next key ($ is Shift+4, and Option+4 on
  // a Norwegian Mac): a command waiting for its motion (the d of d$) keeps waiting.
  if (MODIFIERS.has(k.key)) return pass;
  if (k.ctrlKey === true && (k.key === "r" || k.key === "R") && !s.pending)
    return done(s, c, { history: "redo" });
  // A character typed with Option (or AltGr, which is Ctrl and Alt off a Mac) is a key like any
  // other. Other keys with Ctrl, Cmd or Alt, and named keys (Enter, arrows, Tab), stay the page's.
  const typed =
    k.key.length === 1 && k.metaKey !== true && (k.ctrlKey !== true || k.altKey === true);
  if (!typed) return { ...pass, state: { ...s, pending: "" } };

  const keys = s.pending + k.key;
  const [count1, rest] = splitCount(keys);
  if (!rest) return { handled: true, state: { ...s, pending: keys }, cursor: c };
  const visual = s.mode === "visual" || s.mode === "visual-line";
  const n = count1 ?? 1;
  const wait: Result = { handled: true, state: { ...s, pending: keys }, cursor: c };
  const reset = done(s, c);
  const head = rest.charAt(0);

  // A motion moves the cursor (and the selection's free end).
  const shape = motionShape(rest);
  if (shape === "more" && !"dcy".includes(head)) return wait;
  if (shape === "whole") {
    const m = motion(t, c, rest, n, { ...s, pending: count1 ? String(count1) : "" }, false);
    if (!m) return reset;
    const to = visual ? Math.min(m.to, Math.max(0, t.length - 1)) : clampNormal(t, m.to);
    return done({ ...s, column: m.column, find: m.find ?? s.find }, Math.max(0, to));
  }

  if (visual) return visualKey(s, t, c, rest, n, wait, reset);

  if ("dcy".includes(head)) {
    const op = head;
    const after = rest.slice(1);
    if (!after) return wait;
    if (after === op) {
      // dd, cc, yy on `n` lines.
      let end = c;
      for (let i = 1; i < n; i++) {
        const next = lineEnd(t, end) + 1;
        if (next > t.length) break;
        end = next;
      }
      return operate(s, t, op, c, end, true);
    }
    const [count2, motionKeys] = splitCount(after);
    if (!motionKeys) return wait;
    const total = n * (count2 ?? 1);
    const objectKey = motionKeys.charAt(0);
    if (objectKey === "i" || objectKey === "a") {
      if (motionKeys.length < 2) return wait;
      const r = textObject(t, c, objectKey === "i", motionKeys.charAt(1));
      if (!r) return reset;
      return operate(s, t, op, r.from, r.to, false);
    }
    const shape2 = motionShape(motionKeys);
    if (shape2 === "more") return wait;
    if (shape2 === "no") return reset;
    // cw changes to the end of the word it is on, as ce would from inside it.
    if (op === "c" && (motionKeys === "w" || motionKeys === "W") && kind(at(t, c), false) !== 0) {
      const big = motionKeys === "W";
      let to = c;
      while (to + 1 < t.length && kind(at(t, to + 1), big) === kind(at(t, c), big)) to++;
      for (let i = 1; i < total; i++) to = wordEnd(t, to, big);
      return operate(s, t, "c", c, Math.min(t.length, to + 1), false);
    }
    const m = motion(
      t,
      c,
      motionKeys,
      total,
      { ...s, pending: count2 ? String(count2) : "" },
      true,
    );
    if (!m) return reset;
    const state = { ...s, find: m.find ?? s.find };
    if (m.linewise) return operate(state, t, op, Math.min(c, m.to), Math.max(c, m.to), true);
    const from = Math.min(c, m.to);
    const to = Math.max(c, m.to) + (m.inclusive ? 1 : 0);
    return operate(state, t, op, from, Math.min(to, t.length), false);
  }

  switch (rest) {
    case "i":
      return done({ ...s, mode: "insert" }, c);
    case "a":
      return done({ ...s, mode: "insert" }, Math.min(lineEnd(t, c), c + 1));
    case "I":
      return done({ ...s, mode: "insert" }, firstNonBlank(t, c));
    case "A":
      return done({ ...s, mode: "insert" }, lineEnd(t, c));
    case "o": {
      const le = lineEnd(t, c);
      const indent = t.slice(lineStart(t, c), firstNonBlank(t, c));
      return done({ ...s, mode: "insert" }, le + 1 + indent.length, {
        edit: { from: le, to: le, insert: `\n${indent}` },
      });
    }
    case "O": {
      const ls = lineStart(t, c);
      const indent = t.slice(ls, firstNonBlank(t, c));
      return done({ ...s, mode: "insert" }, ls + indent.length, {
        edit: { from: ls, to: ls, insert: `${indent}\n` },
      });
    }
    case "v":
      return done({ ...s, mode: "visual", anchor: c }, c);
    case "V":
      return done({ ...s, mode: "visual-line", anchor: c }, c);
    case "x":
    case "X": {
      const le = lineEnd(t, c);
      const ls = lineStart(t, c);
      const [from, to] = rest === "x" ? [c, Math.min(le, c + n)] : [Math.max(ls, c - n), c];
      if (from === to) return reset;
      return operate(s, t, "d", from, to, false);
    }
    case "s":
      return operate(s, t, "c", c, Math.min(lineEnd(t, c), c + n), false);
    case "S":
      return operate(s, t, "c", c, c, true);
    case "D":
    case "C":
      return operate(s, t, rest === "D" ? "d" : "c", c, lineEnd(t, c), false);
    case "Y":
      return operate(s, t, "y", c, c, true);
    case "p":
    case "P":
      return put(s, t, c, rest === "p", n);
    case "u":
      return done(s, c, { history: "undo" });
    case "~": {
      const to = Math.min(lineEnd(t, c), c + n);
      if (to === c) return reset;
      return done(s, Math.min(to, lastOnLine(t, c)), {
        edit: { from: c, to, insert: toggleCase(t.slice(c, to)) },
      });
    }
    case "J": {
      // J joins the next line on: its leading spaces become one space.
      const le = lineEnd(t, c);
      if (le >= t.length) return reset;
      let next = le + 1;
      while (next < t.length && isBlank(at(t, next))) next++;
      const joint = next >= t.length || at(t, next) === "\n" || le === lineStart(t, c) ? "" : " ";
      return done(s, le, { edit: { from: le, to: next, insert: joint } });
    }
  }
  if (head === "r") {
    if (rest.length < 2) return wait;
    const to = c + n;
    if (to > lineEnd(t, c)) return reset;
    return done(s, to - 1, { edit: { from: c, to, insert: rest.charAt(1).repeat(n) } });
  }
  // Any other key types nothing in normal mode.
  return reset;
}

/** A key in visual mode that is not a motion: an operator on the selection, a text object, or a
 *  change of mode. */
function visualKey(
  s: VimState,
  t: string,
  c: number,
  rest: string,
  n: number,
  wait: Result,
  reset: Result,
): Result {
  const lines = s.mode === "visual-line";
  const lo = Math.min(s.anchor, c);
  const hi = Math.max(s.anchor, c);
  const end = Math.min(t.length, hi + 1);
  const head = rest.charAt(0);
  if (head === "i" || head === "a") {
    if (rest.length < 2) return wait;
    const r = textObject(t, c, head === "i", rest.charAt(1));
    if (!r || r.to <= r.from) return reset;
    return done({ ...s, mode: "visual", anchor: r.from }, r.to - 1);
  }
  switch (rest) {
    case "v":
      return lines ? done({ ...s, mode: "visual" }, c) : toNormal(s, t, c);
    case "V":
      return lines ? toNormal(s, t, c) : done({ ...s, mode: "visual-line" }, c);
    case "o":
      return done({ ...s, anchor: c }, s.anchor);
    case "d":
    case "x":
    case "y":
    case "c":
    case "s":
      return operate(
        s,
        t,
        rest === "x" ? "d" : rest === "s" ? "c" : rest,
        lo,
        lines ? hi : end,
        lines,
      );
    case "D":
    case "X":
    case "Y":
    case "C":
    case "S":
      return operate(
        s,
        t,
        rest === "Y" ? "y" : rest === "D" || rest === "X" ? "d" : "c",
        lo,
        hi,
        true,
      );
    case "~":
    case "u":
    case "U": {
      const [from, to] = lines ? [lineStart(t, lo), lineEnd(t, hi)] : [lo, end];
      const text = t.slice(from, to);
      const insert =
        rest === "~" ? toggleCase(text) : rest === "u" ? text.toLowerCase() : text.toUpperCase();
      return toNormal(s, t, from, { edit: { from, to, insert } });
    }
    case "p":
    case "P": {
      const [from, to] = lines ? [lineStart(t, lo), lineEnd(t, hi)] : [lo, end];
      const r = s.register;
      const insert = Array.from({ length: n }, () => r.text).join(r.linewise ? "\n" : "");
      // The selection goes into the register, as vim's p does.
      const register = { text: t.slice(from, to), linewise: lines };
      return toNormal(
        { ...s, register },
        t.slice(0, from) + insert + t.slice(to),
        from + Math.max(0, insert.length - 1),
        { edit: { from, to, insert } },
      );
    }
    case "J": {
      const le = lineEnd(t, lo);
      if (le >= t.length) return reset;
      let next = le + 1;
      while (next < t.length && isBlank(at(t, next))) next++;
      return toNormal(s, t, le, { edit: { from: le, to: next, insert: " " } });
    }
  }
  return reset;
}

/** The text a field selects to show vim's state: the block cursor in normal mode (one character),
 *  the selection in visual mode, and a plain caret in insert mode. End exclusive. */
export function selectionOf(s: VimState, doc: Doc): [number, number] {
  const t = doc.text;
  const c = Math.max(0, Math.min(doc.cursor, t.length));
  if (s.mode === "insert") return [c, c];
  if (s.mode === "visual") {
    const lo = Math.min(s.anchor, c);
    const hi = Math.max(s.anchor, c);
    return [lo, Math.min(t.length, hi + 1)];
  }
  if (s.mode === "visual-line") {
    const lo = Math.min(s.anchor, c);
    const hi = Math.max(s.anchor, c);
    return [lineStart(t, lo), lineEnd(t, hi)];
  }
  return c < lineEnd(t, c) ? [c, c + 1] : [c, c];
}

/** The mode as the badge names it; nothing for insert, the calm default. */
export const MODE_WORDS: Record<Mode, string> = {
  insert: "INSERT",
  normal: "NORMAL",
  visual: "VISUAL",
  "visual-line": "V-LINE",
};
