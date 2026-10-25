import type { Image, Message, Note } from "../notes/note";
import { shotToken } from "../notes/shots";
import { stepNoteId } from "../session/machine";
import type { Kept } from "../session/state";
import type { JourneyInfo } from "../types";

/*
 * The workshop's mock chats: one step for each thing a chat shows, with made-up words and
 * drawn pictures, so the parts can be judged before an agent sends them.
 */

/** A drawn page, as a screenshot of one: a header, rows and a button. */
function sketch(title: string, rows: readonly string[], button: string, accent = "#4a6cf7") {
  const lines = rows
    .map(
      (row, i) =>
        `<rect x="16" y="${String(56 + i * 30)}" width="288" height="22" rx="4" fill="#f1f1f4"/>` +
        `<text x="26" y="${String(71 + i * 30)}" font-size="11" fill="#3b3b44">${row}</text>`,
    )
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" font-family="system-ui">` +
    `<rect width="320" height="200" fill="#fbfbfc"/>` +
    `<text x="16" y="34" font-size="15" font-weight="600" fill="#16161a">${title}</text>` +
    lines +
    `<rect x="196" y="164" width="108" height="24" rx="5" fill="${accent}"/>` +
    `<text x="250" y="180" font-size="11" fill="#fff" text-anchor="middle">${button}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const shot = (name: string): Image => ({ name, file: "" });

const BEFORE = sketch("Approvers", ["Kari Nordmann", "Ola Hansen", "Due date"], "Send");
const AFTER = sketch(
  "Approvers",
  ["Due date: 4 November", "Kari Nordmann · Director", "Ola Hansen · Finance"],
  "Send for approval",
);
const ROWS = sketch("Approvers", ["Kari Nordmann", "Ola Hansen"], "Send for approval");
const CHIPS = sketch("Approvers", ["Kari N.   Ola H.   + 1"], "Send for approval");
const TABLE = sketch(
  "Approvers",
  [
    "Name          Role        Due",
    "Kari Nordmann  Director  4 Nov",
    "Ola Hansen      Finance   4 Nov",
  ],
  "Send for approval",
);

const group = { id: "chat", title: "Chat parts" };

export const WORKSHOP: JourneyInfo = {
  id: "workshop",
  title: "Chat workshop",
  steps: [
    {
      id: "talk",
      title: "Words, screenshots and notes",
      look: "The reviewer's message with two screenshots, one named in the words, and two notes sent with it. The agent answers in words.",
      group,
    },
    {
      id: "plan",
      title: "The agent's plan",
      look: "The agent is on it and shows its plan under that, with what is done. The plan changes in place as the agent goes on.",
      group,
    },
    {
      id: "question",
      title: "A question with answers",
      look: "One answer: a click or its number sends it. Your own words go with it, or alone.",
      group,
    },
    {
      id: "several",
      title: "A question with several answers",
      look: "Choose any answers, add words if you like, and send them at once.",
      group,
    },
    {
      id: "actions",
      title: "Buttons the agent listens for",
      look: "A click sends the button's words, which the agent waits for.",
      group,
    },
    {
      id: "variants",
      title: "Variants side by side",
      look: "The agent made three variants. A click shows one, the star keeps it.",
      group,
      variants: [{ label: "Rows" }, { label: "Chips" }, { label: "Table" }],
    },
    {
      id: "changes",
      title: "Changes on the page, before and after",
      look: "Point at a change to light its element on the page at the left. Drag the line to compare.",
      group,
    },
    {
      id: "results",
      title: "Numbers, a callout and a log",
      look: "What the checks found: numbers with what they were, a warning, and the log kept closed.",
      group,
    },
    {
      id: "code",
      title: "Code and a table",
      look: "A diff with its file, which copies, and a table of what maps to what.",
      group,
    },
    {
      id: "form",
      title: "A form",
      look: "Values the agent needs at once. Send sends them as one message, a line for each.",
      group,
    },
    {
      id: "followups",
      title: "What to say next",
      look: "Suggestions under an answer; a click sends one, and they go once you say anything.",
      group,
    },
    {
      id: "shots",
      title: "Screenshots",
      look: "The agent's screenshots of each state, with what each shows.",
      group,
    },
    {
      id: "settled",
      title: "A settled step",
      look: "The reviewer said it is right, and the agent settled it.",
      group,
    },
  ],
};

const you = (at: number, text: string, more: Partial<Message> = {}): Message => ({
  by: "you",
  text,
  at,
  ...more,
});
const agent = (at: number, text: string, more: Partial<Message> = {}): Message => ({
  by: "agent",
  text,
  at,
  ...more,
});

const note = (step: string, state: Note["state"], thread: readonly Message[]): Note => ({
  id: stepNoteId(step),
  step,
  thread,
  draft: "",
  state,
  unread: false,
});

const NOTES: readonly Note[] = [
  note("talk", "replied", [
    you(1, `The list is hard to scan, as in ${shotToken(1)}. And the button says too little.`, {
      images: [shot(BEFORE), shot(AFTER)],
      pins: [
        {
          id: "pin-talk-1",
          pin: { what: "the approvers list", selector: "[data-review=approvers]" },
          text: "Show the role",
        },
        {
          id: "pin-talk-2",
          pin: { what: "the Send button", selector: "[data-review=send]" },
          text: "Say what it sends",
        },
      ],
    }),
    agent(
      2,
      "I put the due date first and the role after each name, and the button now says Send for approval. Both notes are done.",
    ),
  ]),
  {
    ...note("plan", "working", [
      you(1, "Group the approvers by role, and keep the due date on top."),
    ]),
    progress: [
      {
        kind: "plan",
        items: [
          { text: "Read the note and the step", state: "done" },
          { text: "Group the approvers by role", state: "done" },
          { text: "Keep the due date above the list", state: "doing" },
          { text: "Take new screenshots", state: "todo" },
        ],
      },
    ],
  },
  note("question", "replied", [
    you(1, "The button should say what happens."),
    agent(2, "", {
      blocks: [
        {
          kind: "question",
          text: "Which words should the button have?",
          options: [
            { label: "Send for approval", detail: "The words the matrix uses" },
            { label: "Ask the approvers" },
            { label: "Submit", detail: "Short, but says less" },
          ],
        },
      ],
    }),
  ]),
  note("several", "replied", [
    you(1, "Show more about each approver."),
    agent(2, "", {
      blocks: [
        {
          kind: "question",
          text: "What should each row show?",
          multiple: true,
          options: [
            { label: "Role" },
            { label: "Department" },
            { label: "When they last approved", detail: "From the matrix history" },
            { label: "Who stands in for them" },
          ],
        },
      ],
    }),
  ]),
  note("actions", "replied", [
    you(1, "The fake data looks wrong after the reset."),
    agent(2, "I made the reset fill the approvers again. Shall I run it on the dev data now?", {
      blocks: [
        {
          kind: "actions",
          items: [
            { label: "Run the reset", send: "Run the reset now", primary: true },
            { label: "Not yet", send: "Do not run the reset yet" },
          ],
        },
      ],
    }),
  ]),
  note("variants", "replied", [
    you(1, "Try other ways to show the approvers."),
    agent(2, "I made three. Each keeps the due date and the button.", {
      blocks: [
        {
          kind: "variants",
          items: [
            { label: "Rows", detail: "One person on each line", image: ROWS },
            { label: "Chips", detail: "Small, for many approvers", image: CHIPS },
            { label: "Table", detail: "Role and due date in columns", image: TABLE },
          ],
        },
      ],
    }),
  ]),
  note("changes", "replied", [
    you(1, "Make the approvers easier to read."),
    agent(2, "Done. Here is what changed.", {
      blocks: [
        {
          kind: "changes",
          items: [
            { text: "Put the due date above the list", target: "[data-review=due]" },
            { text: "Added each approver's role", target: "[data-review=approvers]" },
            {
              text: "Renamed the button",
              target: "[data-review=send]",
              before: "Send",
              after: "Send for approval",
            },
          ],
        },
        { kind: "compare", before: BEFORE, after: AFTER },
      ],
    }),
  ]),
  note("results", "replied", [
    you(1, "Is it faster now?"),
    agent(2, "Yes. The checks pass, but one test is slow.", {
      blocks: [
        {
          kind: "metrics",
          items: [
            { label: "Load time", value: "0.8 s", before: "2.1 s", better: "down" },
            { label: "Tests", value: "137", before: "135", better: "up" },
            { label: "Bundle", value: "212 kB", before: "204 kB", better: "down" },
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: "One slow test",
          text: "The matrix import test takes 4 seconds. It reads the whole fixture.",
        },
        {
          kind: "details",
          summary: "The test log",
          text: "✓ test/blocks.test.ts (2 tests) 3ms\n✓ test/session.test.ts (41 tests) 52ms\n✓ test/import.test.ts (6 tests) 4012ms\n\nTests  137 passed (137)",
        },
      ],
    }),
  ]),
  note("code", "replied", [
    you(1, "Where does the role come from?"),
    agent(2, "From the person's grant. This is the change:", {
      blocks: [
        {
          kind: "code",
          file: "src/matrix/approvers.tsx:42",
          diff: true,
          text: '  <li className="flex justify-between">\n-   <span>{person.name}</span>\n+   <span className="font-medium">{person.name}</span>\n+   <span className="text-muted">{grant.role}</span>\n  </li>',
        },
        {
          kind: "table",
          text: "Where each part comes from",
          columns: ["On the page", "From", "Field"],
          rows: [
            ["Name", "Person", "displayName"],
            ["Role", "Grant", "role"],
            ["Due date", "Matter", "dueAt"],
          ],
        },
      ],
    }),
  ]),
  note("form", "replied", [
    you(1, "Remind the approvers when it is late."),
    agent(2, "", {
      blocks: [
        {
          kind: "form",
          text: "How should the reminder work?",
          fields: [
            { label: "Days late", type: "number", value: 3 },
            { label: "Send by", type: "select", options: ["Mail", "Teams", "Both"] },
            { label: "Copy the owner", type: "toggle", value: true },
            { label: "Subject", type: "text", value: "Waiting for your approval" },
          ],
          submit: "Use these",
        },
      ],
    }),
  ]),
  note("followups", "replied", [
    you(1, "Why is Ola listed twice?"),
    agent(2, "Ola has two grants: Finance and a stand-in for Kari. The list shows each grant.", {
      blocks: [
        {
          kind: "followups",
          items: [
            "Show each person once, with both roles",
            "Hide the stand-in grants",
            "Keep it as it is",
          ],
        },
      ],
    }),
  ]),
  note("shots", "replied", [
    you(1, "Show me the states of the list."),
    agent(2, "Here are the three states.", {
      blocks: [
        {
          kind: "images",
          items: [
            { image: ROWS, caption: "Two approvers" },
            { image: CHIPS, caption: "Many approvers, as chips" },
            { image: TABLE, caption: "With the due date" },
            { image: BEFORE, caption: "Before the change" },
          ],
        },
      ],
    }),
  ]),
  {
    ...note("settled", "settled", [
      you(1, "Bold the names."),
      agent(2, "The names are bold now."),
      you(3, "That is right, settle it."),
      agent(4, "Settled."),
    ]),
    settledBy: "agent",
  },
];

/** The session the workshop starts with: on the variants step, so its star keeps one. */
export const KEPT: Kept = {
  journey: WORKSHOP.id,
  active: true,
  at: WORKSHOP.steps.findIndex((s) => s.id === "variants"),
  variants: {},
  feedback: { settled: { settled: true } },
  notes: NOTES,
  panel: true,
  design: "",
  chat: "step",
  folds: {},
  finish: null,
};

/** A note in each state, for the line that says where a note is. */
export const STATES: readonly Note[] = (
  ["new", "waiting", "working", "replied", "settled"] as const
).map((state) => ({ ...note("states", state, []), id: `state:${state}` }));
