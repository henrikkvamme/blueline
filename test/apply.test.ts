import { describe, expect, it } from "vitest";
import { applyVerdicts, dropPartFields, verdictsIn } from "../bin/apply";

const CARD = `import { useState } from "react";
import { variants } from "@henrikkvamme/blueline/variants";

type CardProps = { s: Suggestion; since: boolean };

export const SuggestionView = variants<CardProps>(
  "Suggestion",
  {
    "Card under the field": (p) => <Shell p={p} className="bg-caution-wash" />,
    // The change as struck and added words.
    "Tracked change": (p) => <Shell p={p} className="border-l-2" />,
    "Marked field": (p) => <Shell p={p} className="ring-1" />,
  },
  {
    Accepted: { s: { state: "accepted" } },
  },
);
`;

describe("the reviewer's verdicts, applied to the code", () => {
  it("makes the one kept variant the whole part, typed, without the import", () => {
    const { source, changes } = applyVerdicts("card.tsx", CARD, "Suggestion", {
      kept: ["Tracked change"],
      dropped: [],
    });
    expect(source).toContain(
      'export const SuggestionView = (p: CardProps) => <Shell p={p} className="border-l-2" />;',
    );
    expect(source).not.toContain("variants");
    expect(source).not.toContain("Accepted");
    expect(source).toContain('import { useState } from "react";\n\ntype CardProps');
    expect(changes).toEqual(['card.tsx:6: Suggestion is now "Tracked change" alone']);
  });

  it("leaves no blank line where the import stood first", () => {
    const first = CARD.replace('import { useState } from "react";\n', "");
    const kept = { kept: ["Marked field"], dropped: [] };
    expect(applyVerdicts("card.tsx", first, "Suggestion", kept).source).toMatch(/^type CardProps/);
  });

  it("takes the deleted variants out, and keeps the call", () => {
    const { source } = applyVerdicts("card.tsx", CARD, "Suggestion", {
      kept: [],
      dropped: ["Tracked change", "Marked field"],
    });
    expect(source).toContain('"Card under the field"');
    expect(source).not.toContain("Tracked change");
    expect(source).not.toContain("struck");
    expect(source).not.toContain("Marked field");
    expect(source).toContain("variants<CardProps>(");
  });

  it("asks which variant to keep when the reviewer kept more than one", () => {
    const two = { kept: ["Tracked change", "Marked field"], dropped: [] };
    expect(() => applyVerdicts("card.tsx", CARD, "Suggestion", two)).toThrow(/--keep/);
    expect(applyVerdicts("card.tsx", CARD, "Suggestion", two, "Marked field").source).toContain(
      'className="ring-1"',
    );
  });

  it("leaves a file without the part as it is", () => {
    expect(
      applyVerdicts("x.ts", "const a = 1;\n", "Suggestion", { kept: ["A"], dropped: [] }),
    ).toEqual({ source: "const a = 1;\n", changes: [] });
  });

  it("takes the review steps' part field away", () => {
    const steps = `const step = {\n  id: "P5.card",\n  part: "Suggestion",\n  title: "A card",\n};\n`;
    expect(dropPartFields("steps.ts", steps, "Suggestion").source).toBe(
      `const step = {\n  id: "P5.card",\n  title: "A card",\n};\n`,
    );
  });

  it("reads the newest verdicts on the part from the feedback file", () => {
    const lines = [
      JSON.stringify({ parts: { Suggestion: { kept: ["A"], dropped: [] } } }),
      JSON.stringify({ parts: { Other: { kept: [], dropped: ["X"] } } }),
      "{ half a line",
    ];
    expect(verdictsIn(lines, "Suggestion")).toEqual({ kept: ["A"], dropped: [] });
    expect(verdictsIn(lines, "Missing")).toBeUndefined();
  });
});
