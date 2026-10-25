import type { Block } from "../../notes/blocks";
import type { Message, Note } from "../../notes/note";
import { Actions, FollowUps, Form, Question } from "./ask";
import { Changes, Compare, Variants } from "./page";
import { Callout, Code, Details, Gallery, Metrics, Plan, Table } from "./show";

/*
 * The blocks of an agent's answer, under its words in the thread: each is plain data from
 * the agent (notes/blocks.ts), and each acts through the session, as the keys do.
 */

export function Blocks({
  blocks,
  note,
  after,
}: {
  readonly blocks: readonly Block[];
  readonly note: Note;
  readonly after: readonly Message[];
}) {
  return blocks.map((block, i) => {
    const key = String(i);
    const asks = { note, after };
    switch (block.kind) {
      case "question":
        return <Question key={key} block={block} {...asks} />;
      case "actions":
        return <Actions key={key} block={block} {...asks} />;
      case "form":
        return <Form key={key} block={block} {...asks} />;
      case "followups":
        return <FollowUps key={key} block={block} {...asks} />;
      case "variants":
        return <Variants key={key} block={block} {...asks} />;
      case "changes":
        return <Changes key={key} block={block} />;
      case "compare":
        return <Compare key={key} block={block} />;
      case "plan":
        return <Plan key={key} block={block} />;
      case "callout":
        return <Callout key={key} block={block} />;
      case "table":
        return <Table key={key} block={block} />;
      case "code":
        return <Code key={key} block={block} />;
      case "metrics":
        return <Metrics key={key} block={block} />;
      case "details":
        return <Details key={key} block={block} />;
      case "images":
        return <Gallery key={key} block={block} />;
    }
  });
}
