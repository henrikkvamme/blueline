import { describe, expect, it } from "vitest";
import {
  clampNormal,
  initialVim,
  selectionOf,
  vimKey,
  type Key,
  type Mode,
  type Result,
} from "../src/vim/engine";

/** Runs keys from `cursor` in `text`, applying each edit as a field would. A key is one character,
 *  or a `Key` for Escape and Ctrl keys. */
function run(
  text: string,
  cursor: number,
  keys: ReadonlyArray<string | Key>,
  mode: Mode = "normal",
) {
  let state = initialVim(mode);
  let doc = { text, cursor };
  let last: Result | undefined;
  const all = keys.flatMap((k): Key[] =>
    typeof k === "string" ? k.split("").map((key) => ({ key })) : [k],
  );
  for (const k of all) {
    const r = vimKey(state, doc, k);
    const next = r.edit
      ? doc.text.slice(0, r.edit.from) + r.edit.insert + doc.text.slice(r.edit.to)
      : doc.text;
    state = r.state;
    doc = { text: next, cursor: r.cursor };
    last = r;
  }
  return { ...doc, state, last };
}

const esc: Key = { key: "Escape" };

describe("motions", () => {
  it("w moves to the next word", () => {
    expect(run("foo bar baz", 0, ["w"]).cursor).toBe(4);
  });
  it("w stops at punctuation, W does not", () => {
    expect(run("foo.bar baz", 0, ["w"]).cursor).toBe(3);
    expect(run("foo.bar baz", 0, ["W"]).cursor).toBe(8);
  });
  it("b moves to the start of the word before", () => {
    expect(run("foo bar baz", 8, ["b"]).cursor).toBe(4);
  });
  it("e moves to the end of the word", () => {
    expect(run("foo bar", 0, ["e"]).cursor).toBe(2);
    expect(run("foo bar", 2, ["e"]).cursor).toBe(6);
  });
  it("0 and $ go to the line's ends", () => {
    expect(run("  foo bar", 5, ["0"]).cursor).toBe(0);
    expect(run("  foo bar", 0, ["$"]).cursor).toBe(8);
  });
  it("^ goes to the first non-blank", () => {
    expect(run("  foo", 4, ["^"]).cursor).toBe(2);
  });
  it("gg and G go to the first and last line", () => {
    expect(run("one\ntwo\nthree", 9, ["gg"]).cursor).toBe(0);
    expect(run("one\ntwo\nthree", 0, ["G"]).cursor).toBe(8);
  });
  it("j and k keep the column", () => {
    const down = run("abcdef\nab\nabcdef", 4, ["j"]);
    expect(down.cursor).toBe(8);
    expect(run("abcdef\nab\nabcdef", 4, ["jj"]).cursor).toBe(14);
  });
  it("f and t find on the line", () => {
    expect(run("a,b,c", 0, ["f,"]).cursor).toBe(1);
    expect(run("a,b,c", 0, ["t,"]).cursor).toBe(0);
    expect(run("abc,d", 0, ["t,"]).cursor).toBe(2);
  });
  it("; repeats the find and , reverses it", () => {
    expect(run("a,b,c,d", 0, ["f,;"]).cursor).toBe(3);
    expect(run("a,b,c,d", 0, ["f,;,"]).cursor).toBe(1);
  });
  it("a find with no match stays put", () => {
    const r = run("abc", 0, ["fz"]);
    expect(r.cursor).toBe(0);
    expect(r.state.pending).toBe("");
  });
  it("% jumps to the matching bracket", () => {
    expect(run("f(a(b)c)", 0, ["%"]).cursor).toBe(7);
  });
  it("h does not leave the line", () => {
    expect(run("ab\ncd", 3, ["h"]).cursor).toBe(3);
  });
});

describe("counts", () => {
  it("3w moves three words", () => {
    expect(run("a b c d e", 0, ["3w"]).cursor).toBe(6);
  });
  it("2dd deletes two lines", () => {
    const r = run("one\ntwo\nthree", 0, ["2dd"]);
    expect(r.text).toBe("three");
    expect(r.state.register).toEqual({ text: "one\ntwo", linewise: true });
  });
  it("d2w deletes two words", () => {
    expect(run("a b c", 0, ["d2w"]).text).toBe("c");
  });
  it("3x deletes three characters", () => {
    expect(run("abcdef", 1, ["3x"]).text).toBe("aef");
  });
  it("a count waits for its command", () => {
    const r = run("abc", 0, ["2"]);
    expect(r.last?.handled).toBe(true);
    expect(r.state.pending).toBe("2");
  });
});

describe("operators", () => {
  it("dw deletes to the next word", () => {
    const r = run("foo bar", 0, ["dw"]);
    expect(r.text).toBe("bar");
    expect(r.state.register.text).toBe("foo ");
  });
  it("dw on the last word of a line keeps the line break", () => {
    expect(run("foo bar\nbaz", 4, ["dw"]).text).toBe("foo \nbaz");
  });
  it("cw changes to the end of the word and enters insert", () => {
    const r = run("foo bar", 0, ["cw"]);
    expect(r.text).toBe(" bar");
    expect(r.state.mode).toBe("insert");
    expect(r.cursor).toBe(0);
  });
  it("ciw changes the inner word", () => {
    const r = run("one two three", 5, ["ciw"]);
    expect(r.text).toBe("one  three");
    expect(r.state.mode).toBe("insert");
  });
  it("daw takes the word and its space", () => {
    expect(run("one two three", 5, ["daw"]).text).toBe("one three");
  });
  it('di" deletes inside quotes', () => {
    expect(run('say "hi there" now', 6, ['di"']).text).toBe('say "" now');
  });
  it("da( deletes the brackets too", () => {
    expect(run("f(a, (b)) x", 3, ["da("]).text).toBe("f x");
  });
  it("ci{ works from a nested bracket's outside", () => {
    expect(run("{ a { b } c }", 2, ["ci{"]).text).toBe("{}");
  });
  it("d$ and D delete to the line's end", () => {
    expect(run("abc def\nx", 4, ["d$"]).text).toBe("abc \nx");
    expect(run("abc def\nx", 4, ["D"]).text).toBe("abc \nx");
  });
  it("dt, deletes up to the comma", () => {
    expect(run("abc,def", 0, ["dt,"]).text).toBe(",def");
  });
  it("dd deletes the line and its break", () => {
    const r = run("one\ntwo\nthree", 5, ["dd"]);
    expect(r.text).toBe("one\nthree");
    expect(r.cursor).toBe(4);
  });
  it("dd on the last line takes the break before it", () => {
    expect(run("one\ntwo", 5, ["dd"]).text).toBe("one");
  });
  it("yy then p puts the line below", () => {
    const r = run("one\ntwo", 0, ["yyp"]);
    expect(r.text).toBe("one\none\ntwo");
    expect(r.cursor).toBe(4);
  });
  it("yw then P puts the text before the cursor", () => {
    expect(run("ab cd", 3, ["yw0P"]).text).toBe("cdab cd");
  });
  it("x deletes the character and fills the register", () => {
    const r = run("abc", 1, ["x"]);
    expect(r.text).toBe("ac");
    expect(r.state.register).toEqual({ text: "b", linewise: false });
  });
  it("x then p swaps two characters", () => {
    expect(run("ab", 0, ["xp"]).text).toBe("ba");
  });
  it("r replaces the character", () => {
    const r = run("abc", 1, ["rz"]);
    expect(r.text).toBe("azc");
    expect(r.cursor).toBe(1);
  });
  it("J joins the next line with one space", () => {
    expect(run("foo\n    bar", 0, ["J"]).text).toBe("foo bar");
  });
  it("~ toggles case and moves on", () => {
    const r = run("abC", 0, ["~~~"]);
    expect(r.text).toBe("ABc");
  });
  it("an unknown operator motion resets the command", () => {
    const r = run("abc", 0, ["dq"]);
    expect(r.text).toBe("abc");
    expect(r.state.pending).toBe("");
  });
});

describe("visual mode", () => {
  it("v with a motion then d deletes the selection", () => {
    const r = run("hello world", 0, ["vlld"]);
    expect(r.text).toBe("lo world");
    expect(r.state.mode).toBe("normal");
  });
  it("V then d deletes whole lines", () => {
    expect(run("one\ntwo\nthree", 0, ["Vjd"]).text).toBe("three");
  });
  it("viw selects the inner word", () => {
    const r = run("one two three", 5, ["viw"]);
    expect(selectionOf(r.state, r)).toEqual([4, 7]);
  });
  it("selectionOf draws a block cursor in normal mode", () => {
    expect(selectionOf(initialVim("normal"), { text: "abc", cursor: 1 })).toEqual([1, 2]);
    expect(selectionOf(initialVim("insert"), { text: "abc", cursor: 1 })).toEqual([1, 1]);
  });
  it("Esc leaves visual mode for normal", () => {
    expect(run("abc", 0, ["vl", esc]).state.mode).toBe("normal");
  });
  it("U in visual upper-cases the selection", () => {
    expect(run("abc def", 0, ["veU"]).text).toBe("ABC def");
  });
});

describe("undo and redo", () => {
  it("u asks for the field's undo", () => {
    const r = run("abc", 0, ["u"]);
    expect(r.last?.history).toBe("undo");
    expect(r.last?.handled).toBe(true);
  });
  it("Ctrl+R asks for the field's redo", () => {
    expect(run("abc", 0, [{ key: "r", ctrlKey: true }]).last?.history).toBe("redo");
  });
});

describe("modes", () => {
  it("Esc in insert goes to normal one place to the left", () => {
    const r = run("abc", 3, [esc], "insert");
    expect(r.state.mode).toBe("normal");
    expect(r.cursor).toBe(2);
  });
  it("insert mode leaves typed keys to the field", () => {
    const r = run("abc", 0, ["x"], "insert");
    expect(r.last?.handled).toBe(false);
    expect(r.text).toBe("abc");
  });
  it("Esc in normal mode with nothing pending is the page's", () => {
    expect(run("abc", 0, [esc]).last?.handled).toBe(false);
  });
  it("Esc in normal mode cancels a pending command", () => {
    const r = run("abc", 0, ["d", esc]);
    expect(r.last?.handled).toBe(true);
    expect(r.state.pending).toBe("");
  });
  it("i, a, I and A enter insert at the right place", () => {
    expect(run("  abc", 3, ["i"]).cursor).toBe(3);
    expect(run("  abc", 3, ["a"]).cursor).toBe(4);
    expect(run("  abc", 3, ["I"]).cursor).toBe(2);
    expect(run("  abc\nx", 3, ["A"]).cursor).toBe(5);
    expect(run("abc", 0, ["A"]).state.mode).toBe("insert");
  });
  it("o and O open a line with the indent", () => {
    const below = run("  abc\nx", 3, ["o"]);
    expect(below.text).toBe("  abc\n  \nx");
    expect(below.cursor).toBe(8);
    expect(below.state.mode).toBe("insert");
    const above = run("  abc", 3, ["O"]);
    expect(above.text).toBe("  \n  abc");
    expect(above.cursor).toBe(2);
  });
  it("Enter and Cmd keys in normal mode are the page's", () => {
    expect(run("abc", 0, [{ key: "Enter" }]).last?.handled).toBe(false);
    expect(run("abc", 0, [{ key: "a", metaKey: true }]).last?.handled).toBe(false);
  });
  it("a modifier alone keeps a pending command", () => {
    const r = run("abc def", 0, ["d", { key: "Shift" }, "$"]);
    expect(r.text).toBe("");
  });
});

describe("the block cursor", () => {
  it("sits on a line's last character, not after it, as a press at the end puts it", () => {
    expect(clampNormal("hello there", 11)).toBe(10);
    expect(clampNormal("abc\ndef", 3)).toBe(2);
    expect(clampNormal("abc\n\ndef", 4)).toBe(4);
    expect(clampNormal("", 0)).toBe(0);
  });
});
