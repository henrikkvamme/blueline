import { describe, expect, it } from "vitest";
import { hasShots, insertShots, partsOf, removeShot, shotAt, shotToken } from "../src/notes/shots";

const s = shotToken;

describe("insertShots", () => {
  it("puts the token at the cursor, with a space on each side", () => {
    const r = insertShots("the button here is too small", 16, [1]);
    expect(r.text).toBe(`the button here ${s(1)} is too small`);
    expect(r.insert).toBe(`${s(1)} `);
    expect(r.cursor).toBe(16 + r.insert.length);
  });

  it("adds a space before the token after a word, and one after it at the end", () => {
    expect(insertShots("look", 4, [2]).text).toBe(`look ${s(2)} `);
  });

  it("puts more tokens side by side", () => {
    expect(insertShots("a b", 2, [1, 2]).text).toBe(`a ${s(1)} ${s(2)} b`);
  });

  it("moves a place in a token to its end", () => {
    const text = `a ${s(1)} b`;
    expect(insertShots(text, 5, [2]).text).toBe(`a ${s(1)} ${s(2)} b`);
  });

  it("keeps the place in the words", () => {
    expect(insertShots("ab", 99, [1]).place).toBe(2);
    expect(insertShots("ab", -3, [1]).text).toBe(`${s(1)} ab`);
  });
});

describe("partsOf", () => {
  it("splits the words into text and chips", () => {
    expect(partsOf(`see ${s(1)} and ${s(2)}`, 2)).toEqual([
      { kind: "text", text: "see " },
      { kind: "shot", text: s(1), number: 1 },
      { kind: "text", text: " and " },
      { kind: "shot", text: s(2), number: 2 },
    ]);
  });

  it("keeps a token for a screenshot the note does not have as text", () => {
    expect(partsOf(`see ${s(3)}`, 2)).toEqual([{ kind: "text", text: `see ${s(3)}` }]);
    expect(hasShots(`see ${s(3)}`, 2)).toBe(false);
  });

  it("keeps a token typed with a plain space as text", () => {
    expect(partsOf("see [Screenshot 1]", 1)).toEqual([
      { kind: "text", text: "see [Screenshot 1]" },
    ]);
  });
});

describe("removeShot", () => {
  it("removes the token and one space beside it", () => {
    expect(removeShot(`a ${s(1)} b`, 1)).toBe("a b");
    expect(removeShot(`${s(1)} b`, 1)).toBe("b");
    expect(removeShot(`a ${s(1)}`, 1)).toBe("a");
    expect(removeShot(`a ${s(1)} `, 1)).toBe("a");
  });

  it("moves the tokens after it up one number", () => {
    expect(removeShot(`${s(1)} x ${s(2)} y ${s(3)}`, 2)).toBe(`${s(1)} x y ${s(2)}`);
  });

  it("removes every token of the screenshot", () => {
    expect(removeShot(`a ${s(1)} b ${s(1)} c`, 1)).toBe("a b c");
  });

  it("keeps the words when the screenshot has no chip", () => {
    expect(removeShot("only words", 1)).toBe("only words");
  });
});

describe("the rule for removal", () => {
  it("keeps the screenshot when its words go: a chip is only a reference", () => {
    const text = `a ${s(1)} b`;
    const token = shotAt(text, 2 + s(1).length, "before");
    expect(token).toEqual({ from: 2, to: 2 + s(1).length, number: 1 });
    const edited = text.slice(0, token?.from) + text.slice(token?.to);
    // The note's screenshots do not change with its words, so the thumbnail stays.
    expect(partsOf(edited, 1)).toEqual([{ kind: "text", text: "a  b" }]);
  });

  it("finds the token that starts at the cursor", () => {
    expect(shotAt(`a ${s(1)}`, 2, "after")?.number).toBe(1);
    expect(shotAt(`a ${s(1)}`, 3, "after")).toBeUndefined();
  });
});
