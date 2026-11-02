/*
 * Feedback into eval cases: for each feedback Henrik gave on an answer (evals/answers/inbox/,
 * from the Wrong box or his words to the agent), a model writes a case in the shape of
 * cases.json, from what he said, where he pointed and looped, what the agent did and why he
 * says it was wrong. The case goes into cases.json as a dev case, and the inbox keeps it as
 * case.json, so it is drafted once. Run the case after: it must fail on the version that gave
 * the answer, before a change makes it pass.
 *
 *   node evals/answers/draft.ts [--dry]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "../..");
const INBOX = path.join(HERE, "inbox");
const CASES = path.join(HERE, "cases.json");
const SDK = path.join(
  REPO,
  "examples/review-demo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
);

const { values: flags } = parseArgs({ options: { dry: { type: "boolean", default: false } } });

interface Sdk {
  readonly query: (args: {
    prompt: string;
    options: Record<string, unknown>;
  }) => AsyncIterable<{ type: string; subtype?: string; structured_output?: unknown }>;
}

const TARGETS = [
  "page",
  "title",
  "asker",
  "status",
  "amount",
  "approvers",
  "submit",
  "approver-list",
  "add",
  "sent",
  "tab-request",
  "tab-approvers",
  "tab-sent",
];

const point = {
  type: "object",
  additionalProperties: false,
  required: ["target"],
  properties: {
    target: { type: "string", enum: TARGETS },
    word: { type: "integer", minimum: 0 },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "group", "page", "turns", "expect"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9-]+$" },
    group: {
      type: "string",
      enum: [
        "mockup-words",
        "mockup-parts",
        "hint",
        "two-places",
        "follow-up",
        "act",
        "journey",
        "question",
        "variant",
        "noise",
        "bounds",
        "interrupt",
      ],
    },
    page: { type: "string", enum: ["/request", "/approvers", "/sent"] },
    remark: { type: "string" },
    turns: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["said", "input"],
        properties: {
          said: { type: "string" },
          input: { type: "string", enum: ["spoken", "circled", "typed"] },
          point: { type: "array", items: point },
          circle: point,
          when: { type: "string", enum: ["after", "first-beat"] },
        },
      },
    },
    expect: {
      type: "object",
      additionalProperties: false,
      required: ["mockup", "guide"],
      properties: {
        mockup: { type: "string", enum: ["none", "some", "any"] },
        target: { type: "string", enum: TARGETS },
        edits: { type: "string", enum: ["none", "any"] },
        clicks: { type: "string", enum: ["none", "some", "any"] },
        checks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["says", "js"],
            properties: { says: { type: "string" }, js: { type: "string" } },
          },
        },
        guide: { type: "string" },
      },
    },
  },
};

const PROMPT = `You turn Henrik's feedback on one answer of the workshop agent into an eval case, so the eval catches the same failure next time. He reviews a made-up bonus app; he holds keys and speaks (or types), points with his mouse or loops a part, and the agent answers on the page.

Write one case in the schema. Rules:
- turns: what he said and did, from the exchange as it ran: his words, as he said them; "circled" when he looped a part, with circle.target; else "spoken" (or "typed" when the page says he typed), with point targets from where his mouse was. A word index in point or circle is the word he said as the mouse got there. When the feedback was about a follow-up, include the turn before it.
- expect.guide: for two judges. Say what a good answer does, from his feedback, and what would be wrong, naming the failure he saw. Describe the result, not one exact wording or layout; other good answers must still pass. No history.
- expect.mockup, target, clicks, edits, checks: code checks only where one answer is right. checks are JavaScript expressions over q (the queue at the end), start (the queue before he spoke) and doc (the page); for example q.settled.includes('r-title').
- checks run at the end, after every mock-up is gone: use them only for the queue or the page after an act or a journey, never to check a mock-up. Mock-ups are for the judges and for expect.mockup and expect.target.
- remark: only the title of the remark that showed, when his request was about it (such as "settle this"); else leave it out.
- id: short, kebab-case, saying what is tested. group: the closest one (a change of words or figures only is mockup-words).
Use only the targets in the schema.`;

const cases = JSON.parse(readFileSync(CASES, "utf8")) as { id: string }[];
const items = existsSync(INBOX)
  ? readdirSync(INBOX).filter(
      (id) =>
        existsSync(path.join(INBOX, id, "feedback.json")) &&
        !existsSync(path.join(INBOX, id, "case.json")),
    )
  : [];
if (items.length === 0) console.log("No new feedback in evals/answers/inbox/.");
const sdk = (await import(SDK)) as Sdk;
for (const id of items) {
  const feedback = readFileSync(path.join(INBOX, id, "feedback.json"), "utf8");
  let drafted: Record<string, unknown> | undefined;
  for await (const m of sdk.query({
    prompt: `${PROMPT}\n\nThe feedback and the exchange, as data:\n${feedback}`,
    options: {
      model: "claude-opus-5-5",
      tools: [],
      settingSources: [],
      persistSession: false,
      outputFormat: { type: "json_schema", schema: SCHEMA },
      maxTurns: 4,
    },
  }))
    if (m.type === "result" && m.subtype === "success")
      drafted = m.structured_output as Record<string, unknown>;
  if (drafted === undefined) {
    console.log(`${id}: no draft`);
    continue;
  }
  let caseId = String(drafted["id"]);
  while (cases.some((c) => c.id === caseId)) caseId = `${caseId}-2`;
  const made = { ...drafted, id: caseId, set: "dev", source: `feedback ${id}` };
  console.log(`${id} -> ${caseId}\n${JSON.stringify(made, null, 2)}\n`);
  if (flags.dry) continue;
  cases.push(made as { id: string });
  writeFileSync(path.join(INBOX, id, "case.json"), `${JSON.stringify(made, null, 2)}\n`);
}
if (!flags.dry && items.length > 0) writeFileSync(CASES, `${JSON.stringify(cases, null, 2)}\n`);
