import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BlockSchema } from "../src/notes/blocks";
import { BLOCKS_GUIDE } from "../src/mcp/tools";

/* The guide's examples are blocks the panel draws: each decodes, and every kind has one. */

/** Each JSON object in the guide that names a kind. */
function examples(text: string): unknown[] {
  const found: unknown[] = [];
  for (let at = text.indexOf('{"kind"'); at >= 0; at = text.indexOf('{"kind"', at + 1)) {
    let depth = 0;
    for (let i = at; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
      if (depth === 0) {
        found.push(JSON.parse(text.slice(at, i + 1)));
        break;
      }
    }
  }
  return found;
}

describe("the blocks guide", () => {
  const blocks = examples(BLOCKS_GUIDE);

  it("gives examples that are blocks", () => {
    for (const block of blocks)
      expect(() => Schema.decodeUnknownSync(BlockSchema)(block)).not.toThrow();
  });

  it("gives an example of every kind", () => {
    const kinds = BlockSchema.members.map((m) => m.fields.kind.literal);
    expect(new Set(blocks.map((b) => Reflect.get(Object(b), "kind")))).toEqual(new Set(kinds));
  });
});
