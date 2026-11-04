import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/*
 * Feedback on the workshop agent's answers, kept as the start of new eval cases. When Henrik
 * says an answer was wrong, by the Wrong box or in his own words to the agent, the dev server
 * keeps why, the exchange as it ran (what the agent got and every event it sent back), and his
 * audio when there is some. `node evals/answers/draft.ts` writes a case from each one. The
 * inbox stays out of git: it holds his voice and his real use.
 */

export interface Exchange {
  readonly asked: string;
  readonly request: unknown;
  readonly events: unknown[];
}

export interface Feedback {
  readonly reason: string;
  /** Where he said it: the Wrong box, or his words to the agent. */
  readonly by: "box" | "voice";
  readonly exchange: Exchange | undefined;
  /** The page's own record: its trace and what it sent. */
  readonly page?: unknown;
}

/** Keeps one feedback under evals/answers/inbox/<id>/, and gives back its id. */
export async function keepFeedback(root: string, feedback: Feedback, audio?: Uint8Array) {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${feedback.by}`;
  const dir = join(root, "evals", "answers", "inbox", id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "feedback.json"),
    `${JSON.stringify({ id, on: new Date().toISOString(), ...feedback }, null, 1)}\n`,
  );
  if (audio !== undefined) await writeFile(join(dir, "audio.webm"), audio);
  return id;
}
