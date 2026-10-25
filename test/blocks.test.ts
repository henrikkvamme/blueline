import { describe, expect, it } from "vitest";
import { answerText, chosenIn, formText, formValuesIn, metricTrend } from "../src/notes/blocks";

const OPTIONS = [{ label: "Role" }, { label: "Department" }, { label: "Role and due date" }];

describe("a question's answer", () => {
  it("puts each chosen answer on its own line, then the reviewer's words", () => {
    expect(answerText(["Role", "Department"], " And the photo ")).toBe(
      "Role\nDepartment\n\nAnd the photo",
    );
    expect(answerText([], "Something else")).toBe("Something else");
    expect(answerText(["Role"], "")).toBe("Role");
    expect(answerText([], "  ")).toBe("");
  });

  it("reads the chosen answers back as whole lines only", () => {
    expect(chosenIn(answerText(["Role and due date"], "Role matters most"), OPTIONS)).toEqual([
      "Role and due date",
    ]);
    expect(chosenIn("Role\nDepartment", OPTIONS)).toEqual(["Role", "Department"]);
  });
});

describe("a form's answer", () => {
  const FIELDS = [
    { label: "Days late", type: "number" as const },
    { label: "Copy the owner", type: "toggle" as const },
    { label: "Subject", type: "text" as const },
  ];

  it("is a line for each field, and reads back by label", () => {
    const text = formText(FIELDS, [3, true, "Late: please approve"]);
    expect(text).toBe("Days late: 3\nCopy the owner: yes\nSubject: Late: please approve");
    expect(formValuesIn(text, FIELDS)).toEqual(["3", "yes", "Late: please approve"]);
    expect(formValuesIn("Days late: 5", FIELDS)).toEqual(["5", undefined, undefined]);
  });
});

describe("a metric's trend", () => {
  it("is good when it moves the better way, and unknown without one", () => {
    expect(metricTrend({ value: "0.8 s", before: "2.1 s", better: "down" })).toBe("good");
    expect(metricTrend({ value: "212 kB", before: "204 kB", better: "down" })).toBe("bad");
    expect(metricTrend({ value: "137", before: "137", better: "up" })).toBeUndefined();
    expect(metricTrend({ value: "137", before: "135" })).toBeUndefined();
    expect(metricTrend({ value: "fast", before: "slow", better: "up" })).toBeUndefined();
  });
});
