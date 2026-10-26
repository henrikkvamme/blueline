/*
 * The words of `blueline mcp` (bin/mcp.ts): its instructions, and each tool's name,
 * description and input, in the order the agent sees them. An agent's prompt cache holds
 * them, so they never change while it runs, and they hold no counts, times, paths or state
 * (ADR 0005). A change to them costs every agent its cache once: test/fixtures/mcp-tools.json
 * holds them, so that change is a choice.
 */

export const INSTRUCTIONS =
  "Blueline gives you the reviewer's lines from the review panel. Call wait_for_feedback when you wait for the reviewer. Answer each message with reply, on its id. Apply the reviewer's verdicts on a part's variants with apply.";

/** What a wait that got nothing returns: the same words each time. */
export const NOTHING_NEW = "Nothing new. Call wait_for_feedback again to wait more.";

export const WAIT_FOR_FEEDBACK = {
  name: "wait_for_feedback",
  description:
    "Waits for the reviewer's next lines and returns them, each a JSON line after a tag that says when it was sent. A line with an id, a chat's message or the hand-off of a finished review, needs your answer: before you work on it, call reply with state working and your plan, then reply with state replied. A settle before it only says where the review is. The settle with left 0 ends the review: apply the kept variants. Each line comes to you once, here or in a hook. When nothing comes for a while, it says so: call it again to wait more.",
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
        description: "What the panel shows besides your words: your plan, for working.",
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
