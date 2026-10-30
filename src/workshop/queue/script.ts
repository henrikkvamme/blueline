import type { Annotation, Queue, Remark } from "../../queue/queue";
import { arrive, empty } from "../../queue/queue";

/*
 * The queue workshop's journey and its agent, from a script: the remarks that the agent wrote
 * for a made-up bonus request, and the answer it gives to each annotation after a set delay.
 */

export const JOURNEY = "Bonus request";

/** The made-up app's pages. */
export const PAGES = [
  { path: "/request", title: "Request" },
  { path: "/approvers", title: "Approvers" },
  { path: "/sent", title: "Sent" },
] as const;

export type Path = (typeof PAGES)[number]["path"];

/** The elements of the made-up app that a remark or an annotation can be about. */
export const TARGETS: Readonly<Record<string, string>> = {
  title: "the title",
  status: "the status",
  amount: "the amount",
  approvers: "the approvers",
  submit: "the send button",
  "approver-list": "the approver list",
  add: "the add button",
  sent: "the sent message",
};

export const selectorOf = (target: string) => `[data-q="${target}"]`;
export const targetOf = (selector: string) => /data-q="([^"]+)"/.exec(selector)?.[1] ?? "";

const remark = (
  id: string,
  page: Path,
  target: string,
  title: string,
  more: Partial<Remark> = {},
): Remark => ({ id, kind: "look", page, target: selectorOf(target), title, at: 0, ...more });

/** The journey's remarks: three that he settled before, and seven open. */
const REMARKS: readonly Remark[] = [
  remark("r-title", "/request", "title", "The page's title"),
  remark("r-amount-old", "/request", "amount", "The amount field"),
  remark("r-list-old", "/approvers", "approver-list", "The approvers' rows"),
  remark("r-who", "/request", "title", "Who asked, under the title", {
    text: "The person who asked and the age of the request now sit under the title.",
  }),
  remark("r-status", "/request", "status", "How should the status look?", {
    kind: "choice",
    variants: ["Dot", "Pill", "Steps"],
    text: "Three looks for the request's status.",
  }),
  remark("r-currency", "/request", "amount", "The amount keeps its currency", {
    text: "The field shows NOK before the figure, and groups the thousands.",
  }),
  remark("r-send", "/request", "submit", "Send only with two approvers?", {
    kind: "question",
    options: ["Yes, keep it off until then", "No, one is enough"],
    text: "Send is off until the request has two approvers.",
  }),
  remark("r-add", "/approvers", "add", "Add an approver at the end", {
    text: "The new approver goes last in the order.",
  }),
  remark("r-order", "/approvers", "approver-list", "Drag to change the order", {
    text: "Each row has a grip. The numbers follow the new order.",
  }),
  remark("r-sent", "/sent", "sent", "Who has the request now", {
    text: "The page names the approver who has it, and who is next.",
  }),
].map((r, i) => ({ ...r, at: i + 1 }));

export const start = (limit: number): Queue => ({
  ...REMARKS.reduce(arrive, empty(limit)),
  settled: ["r-title", "r-amount-old", "r-list-old"],
});

/** The change the agent makes for an annotation on each element: the words before and
 * after. */
const CHANGES: Readonly<Record<string, { readonly before: string; readonly after: string }>> = {
  title: { before: "Bonus for Kari Nordmann", after: "Bonus: Kari Nordmann" },
  status: { before: "In review", after: "Waits for Ola Hansen" },
  amount: { before: "NOK 40 000", after: "40 000 kr" },
  approvers: { before: "2 approvers", after: "Ola Hansen, then Ingrid Berg" },
  submit: { before: "Send for approval", after: "Send to Ola Hansen" },
  "approver-list": { before: "Director", after: "Director · approves first" },
  add: { before: "Add an approver", after: "Add an approver last" },
  sent: { before: "Ola Hansen has the request now.", after: "With Ola Hansen since 09:12." },
};

export const changeOf = (target: string) =>
  CHANGES[target] ?? { before: "the old words", after: "the new words" };

/** The agent's answer to an annotation. */
export const answerTo = (annotation: Annotation, at: number): Remark => {
  const target = targetOf(annotation.target);
  return {
    id: `answer-${annotation.id}`,
    kind: "answer",
    page: annotation.page,
    target: annotation.target,
    title: `Changed ${TARGETS[target] ?? "the element"}`,
    text: "Check that it still reads right next to the rest.",
    answers: [annotation.id],
    at,
  };
};
