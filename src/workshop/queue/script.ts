import type { Annotation, Beat, Queue, Remark } from "../../queue/queue";
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
  asker: "who asked",
  status: "the status",
  amount: "the amount",
  approvers: "the approvers",
  submit: "the send button",
  "approver-list": "the approver list",
  add: "the add button",
  grip: "the grip",
  sent: "the sent message",
};

export const selectorOf = (target: string) => `[data-q="${target}"]`;
export const targetOf = (selector: string) => /data-q="([^"]+)"/.exec(selector)?.[1] ?? "";

/** What the request's status can say, the page's own first. */
export const STATUSES = ["In review", "Waits for Ingrid Berg", "Approved", "Sent back"];

const beat = (target: string, say: string, more: Partial<Beat> = {}): Beat => ({
  target: selectorOf(target),
  name: TARGETS[target] ?? "the element",
  say,
  ...more,
});

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
    walk: [
      beat("asker", "Who asked, and when, now sit right under the title.", {
        note: "Who asked, and when",
        draw: "underline",
      }),
      beat("title", "Check that the title still reads first, and this line second.", {
        note: "Title first, this second?",
        draw: "circle",
      }),
    ],
  }),
  remark("r-status", "/request", "status", "How should the status look?", {
    kind: "choice",
    variants: ["Dot", "Pill", "Steps"],
    states: STATUSES,
    text: "Three looks for the request's status.",
    walk: [
      beat("status", "Here is the dot: quiet, with the words beside it.", {
        peek: "Dot",
        note: "1 · Dot",
        draw: "circle",
      }),
      beat("status", "The pill stands out more.", {
        peek: "Pill",
        note: "2 · Pill",
        draw: "circle",
      }),
      beat("status", "And steps show how far it has come.", {
        peek: "Steps",
        note: "3 · Steps",
        draw: "circle",
      }),
      beat("status", "Each must also hold a long state, when it waits on a person.", {
        peek: "Pill",
        state: "Waits for Ingrid Berg",
        note: "A long state",
        draw: "circle",
      }),
      beat("status", "Go through the looks and the states in the panel. A click keeps one.", {
        note: "Try each look in each state",
      }),
    ],
  }),
  remark("r-currency", "/request", "amount", "The amount keeps its currency", {
    text: "The field shows NOK before the figure, and groups the thousands.",
    walk: [
      beat("amount", "The amount keeps its currency in front of the figure.", {
        note: "NOK in front",
        draw: "underline",
      }),
      beat("amount", "Your turn: click in the field, then type a large figure.", {
        turn: true,
        note: "Type a large figure",
      }),
    ],
  }),
  remark("r-send", "/request", "submit", "Send only with two approvers?", {
    kind: "question",
    options: ["Yes, keep it off until then", "No, one is enough"],
    text: "Send is off until the request has two approvers.",
    walk: [
      beat("approvers", "These are the approvers. Send counts them.", {
        note: "Send counts these",
        draw: "circle",
      }),
      beat("submit", "With fewer than two, this button stays off. Should it?", {
        note: "Off below two?",
        draw: "circle",
      }),
    ],
  }),
  remark("r-add", "/approvers", "add", "Add an approver at the end", {
    text: "The new approver goes last in the order.",
    walk: [
      beat("add", "Your turn: click Add an approver.", { turn: true, note: "Click it" }),
      beat("approver-list", "The new approver goes last, as number three.", {
        note: "Goes last",
        draw: "underline",
      }),
    ],
  }),
  remark("r-order", "/approvers", "approver-list", "Drag to change the order", {
    text: "Each row has a grip. The numbers follow the new order.",
    walk: [
      beat("grip", "Each row has a grip. Drag it to change who approves first.", {
        note: "Drag to reorder",
        draw: "circle",
      }),
    ],
  }),
  remark("r-sent", "/sent", "sent", "Who has the request now", {
    text: "The page names the approver who has it, and who is next.",
    walk: [
      beat("sent", "This line names who has the request now, and who is next.", {
        note: "Who has it, who is next",
        draw: "underline",
      }),
    ],
  }),
].map((r, i) => ({ ...r, at: i + 1 }));

export const start = (): Queue => ({
  ...REMARKS.reduce(arrive, empty()),
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
    walk: [
      {
        target: annotation.target,
        name: TARGETS[target] ?? "the element",
        say: `I changed this to “${changeOf(target).after}”. Check that it still reads right.`,
        note: `Now “${changeOf(target).after}”`,
        draw: "circle",
      },
    ],
    at,
  };
};
