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
  "tab-request": "the Request tab",
  "tab-approvers": "the Approvers tab",
  "tab-sent": "the Sent tab",
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

/** A beat on the agent's drawing board, in the panel: an option by its number, or all. */
const board = (n: number, say: string, more: Partial<Beat> = {}): Beat => ({
  target: `[data-board="${String(n)}"]`,
  name: `option ${String(n)}`,
  label: String(n),
  say,
  draw: "circle",
  ...more,
});
const boardList = (say: string, more: Partial<Beat> = {}): Beat => ({
  target: "[data-board-list]",
  name: "the options",
  say,
  draw: "circle",
  ...more,
});

const remark = (
  id: string,
  page: Path,
  target: string,
  title: string,
  more: Partial<Remark> = {},
): Remark => ({ id, kind: "look", page, target: selectorOf(target), title, at: 0, ...more });

/** The journey's remarks: three that he settled before, and eleven open. Four ask him to
 * try what the agent can do. */
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
  // The agent asks him to try what it built: each one shows him how, then it is his turn.
  remark("r-try-ask", "/request", "status", "Try it: ask me about the page", {
    text: "Hold ⌥⌘, point at a part, and ask. The agent answers on the page with its cursor.",
    walk: [
      beat(
        "status",
        "Try me. Hold Option and Command, point here, and ask what the status means.",
        {
          note: "Hold ⌥⌘, point, ask",
          draw: "circle",
        },
      ),
      beat("amount", "Or draw a loop round a part while you speak, and I take that part.", {
        note: "Or draw a loop",
        draw: "box",
      }),
    ],
  }),
  remark("r-try-mock", "/request", "amount", "Try it: ask how a change would look", {
    text: "Ask how a part would look, and the agent mocks it up in place, for you to judge by eye.",
    walk: [
      beat(
        "amount",
        "Ask me how something would look, such as this amount in euros. I'll mock it up right here.",
        {
          note: "Ask: how would it look?",
          draw: "underline",
        },
      ),
    ],
  }),
  remark("r-try-journey", "/request", "tab-approvers", "Try it: let me click a journey", {
    text: "Ask the agent to show a journey. It says each click, then makes it.",
    walk: [
      beat(
        "tab-approvers",
        "Ask me to show you a journey, such as adding a third approver and sending. I'll say each click, then make it.",
        {
          note: "Ask me to click through",
          draw: "circle",
        },
      ),
      beat("submit", "Or ask how to do it, and I'll wait for your own clicks.", {
        note: "Or I wait for you",
        draw: "box",
      }),
    ],
  }),
  remark("r-try-build", "/request", "title", "Try it: change this workshop", {
    text: "Ask the agent to change the workshop itself. It changes the code, and the page reloads.",
    walk: [
      beat(
        "title",
        "You can also ask me to change this workshop, say, bigger notes or another mark. I change the code, and the page reloads with it.",
        {
          note: "Shape Blueline by voice",
          draw: "circle",
        },
      ),
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
        label: "1",
        note: "Dot",
        draw: "circle",
      }),
      beat("status", "The pill stands out more.", {
        peek: "Pill",
        label: "2",
        note: "Pill",
        draw: "circle",
      }),
      beat("status", "And steps show how far it has come.", {
        peek: "Steps",
        label: "3",
        note: "Steps",
        draw: "circle",
      }),
      beat("status", "Each must also hold a long state, when it waits on a person.", {
        peek: "Pill",
        state: "Waits for Ingrid Berg",
        note: "A long state",
        draw: "circle",
      }),
      boardList("Go through the looks and the states here. A click keeps one.", {
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
      board(1, "Keep it off until two have said yes,", { note: "Off below two" }),
      board(2, "or let one approver be enough. Pick one.", { note: "One is enough" }),
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

/** What the agent's cursor does when he speaks: it goes to the element, circles it, and says
 * that it is on it, and when it comes back. */
export const heard = (target: string, seconds: number): Beat => ({
  target,
  name: TARGETS[targetOf(target)] ?? "the element",
  say: `Got it. I'll change ${TARGETS[targetOf(target)] ?? "that"}, back in about ${String(seconds)} seconds.`,
  note: `On it · ${String(seconds)} s`,
  // The agent's own mark in the dot: this is its answer to him, not a step of a walk.
  label: "",
  draw: "circle",
});

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
