/*
 * The words of `blueline mcp` (bin/mcp.ts): its instructions, and each tool's name,
 * description and input, in the order the agent sees them. An agent's prompt cache holds
 * them, so they never change while it runs, and they hold no counts, times, paths or state
 * (ADR 0005). A change to them costs every agent its cache once: test/fixtures/mcp-tools.json
 * holds them, so that change is a choice.
 */

/**
 * How an answer shows more than words: the blocks, by when to use each, with the shape of
 * the ones an agent most often needs. The MCP server sends it in its instructions, and
 * `blueline blocks` prints it for an agent on the command line (src/notes/blocks.ts has
 * every field).
 */
export const BLOCKS_GUIDE = [
  "Answer with blocks, not only words, when they say it better. The panel draws each one, and a click on a question's answer, an action or a follow-up sends it as the reviewer's next message. Use them where they help:",
  '- You need a decision: question, {"kind":"question","text":"Which order?","options":[{"label":"Newest first","detail":"As the list is now"},{"label":"By due date"}]}. Add "multiple":true to let the reviewer choose more than one. The reviewer can always write another answer.',
  '- You offer things to do next: actions, {"kind":"actions","items":[{"label":"Apply it","primary":true},{"label":"Try another","send":"Show me another design"}]}; or followups, {"kind":"followups","items":["Make it smaller","Show it on a phone"]}.',
  '- You made designs to choose from: variants, {"kind":"variants","text":"Three ways","items":[{"label":"Cards","detail":"One card a row","image":"cards.png"}]}, with the step\'s variant labels.',
  '- You changed the page: changes, {"kind":"changes","items":[{"text":"The button says Send","target":"form button","before":"Submit","after":"Send"}]}; and compare, {"kind":"compare","before":"before.png","after":"after.png"}, with two screenshots of the same size.',
  '- You need values: form, {"kind":"form","fields":[{"label":"Limit","type":"number","value":5},{"label":"Who","type":"select","options":["Kari","Ola"]}],"submit":"Use these"}.',
  '- To show: callout, {"kind":"callout","tone":"warn","text":"This removes the old data"} (tone info, good, warn or bad); table, {"kind":"table","columns":["Field","Before"],"rows":[["Name","Kari"]]}; code, {"kind":"code","file":"src/page.tsx:12","diff":true,"text":"-old\\n+new"}; metrics, {"kind":"metrics","items":[{"label":"Load","value":"120 ms","before":"300 ms","better":"down"}]}; details, {"kind":"details","summary":"The log","text":"..."}; images, {"kind":"images","items":[{"image":"shot.png","caption":"The empty list"}]}.',
  '- While you work: plan, {"kind":"plan","items":[{"text":"Move the button","state":"doing"}]}, with each item done, doing or todo.',
  "An image is a screenshot's name on the dev server. Keep the words short: the blocks carry the detail.",
].join("\n");

/** How an agent asks for a change to Blueline itself (bin/request.ts). */
export const REQUEST_GUIDE =
  'When Blueline itself is wrong or lacks something you need, ask for the change: run `blueline request "<title>" --body "<what happened, what you expected>"`. It files an issue on Blueline\'s public repository, once per title. Describe Blueline\'s behaviour only: leave out the app, its company and its data.';

export const INSTRUCTIONS = [
  "Blueline gives you the reviewer's lines from the review panel. Call wait_for_feedback when you wait for the reviewer. Answer each message with reply, on its id. Apply the reviewer's verdicts on a part's variants with apply.",
  "",
  BLOCKS_GUIDE,
  "",
  REQUEST_GUIDE,
].join("\n");

/** What a wait that got nothing returns: the same words each time. */
export const NOTHING_NEW = "Nothing new. Call wait_for_feedback again to wait more.";

export const WAIT_FOR_FEEDBACK = {
  name: "wait_for_feedback",
  description:
    "Waits for the reviewer's next lines and returns them, each a JSON line after a tag that says when it was sent. A line with an id, a chat's message or the hand-off of a finished review, needs your answer: before you work on it, call reply with state working and your plan, then reply with state replied. A settle before it only says where the review is. A line whose tag says apply its verdicts now carries verdicts on parts: call apply for each part it names at once, not at the end of the review. The settle with left 0 ends the review. Each line comes to you once, here or in a hook. When nothing comes for a while, it says so: call it again to wait more.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
} as const;

export const REPLY = {
  name: "reply",
  description:
    'Answers a line in the review panel, on its id. working: you are on it, and blocks is your plan, such as {"kind":"plan","items":[{"text":"Move the button","state":"doing"}]}; each working reply puts its plan in place of the last. replied: your answer in text, with the variant it shows on the page and blocks, if any. settled: only after the reviewer said it is right.',
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The line's id." },
      state: { type: "string", enum: ["working", "replied", "settled"] },
      text: { type: "string", description: "Your answer, for replied." },
      variant: {
        type: "string",
        description: "The label of the variant your answer shows on the page, for replied.",
      },
      blocks: {
        type: "array",
        items: { type: "object" },
        description:
          "What the panel shows besides your words, as the instructions say: your plan, for working; for replied, a question, actions, followups, variants, changes, compare, form, callout, table, code, metrics, details or images.",
      },
    },
    required: ["id", "state"],
    additionalProperties: false,
  },
} as const;

export const APPLY = {
  name: "apply",
  description:
    "Applies the reviewer's verdicts on a part's variants to the code and returns each change. With one variant kept, the part's variants() call becomes that variant. With more than one kept, it says which: call it again with keep.",
  inputSchema: {
    type: "object",
    properties: {
      part: { type: "string", description: "The part's name." },
      keep: { type: "string", description: "The label of the variant to keep." },
    },
    required: ["part"],
    additionalProperties: false,
  },
} as const;

/** The tools in the order the agent sees them. */
export const TOOLS = [WAIT_FOR_FEEDBACK, REPLY, APPLY] as const;
