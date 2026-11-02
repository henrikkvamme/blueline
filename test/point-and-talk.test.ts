import { describe, expect, it } from "vitest";
import { pointedWhile } from "../src/workshop/queue/talk";

const word = (text: string, start: number) => ({ text, start, end: start + 0.2 });

describe("point and talk", () => {
  it("gives each word the element under the mouse when he said it", () => {
    const words = [
      word("this", 0.1),
      word("should", 0.4),
      word("look", 0.7),
      word("like", 1.0),
      word("that", 1.6),
    ];
    const trail = [
      { target: "#status", at: 0 },
      { target: "#title", at: 1400 },
    ];
    expect(pointedWhile(words, trail)).toEqual([
      { target: "#status", words: "this should look like" },
      { target: "#title", words: "that" },
    ]);
  });

  it("gives words said off any element to the element before them", () => {
    const words = [word("bold", 0.1), word("here", 0.8)];
    const trail = [
      { target: "#title", at: 0 },
      { target: undefined, at: 500 },
    ];
    expect(pointedWhile(words, trail)).toEqual([{ target: "#title", words: "bold here" }]);
  });
});
