import { startup, type SDKUserMessage, type WarmQuery } from "@anthropic-ai/claude-agent-sdk";
import { type Part, terra } from "./terra.ts";

/*
 * The first answer: one line, about a second after he spoke, that says what he asked for, so
 * a wrong hearing shows before the agent works on it. The dev server's agent and the hearing
 * evals (evals/hearing) use this same code.
 *
 * GPT-6.1 Terra hears, on a warm Codex thread (terra.ts). Claude Haiku 5.5 with no thinking
 * hears only when Terra fails. In the evals Terra was right in 100% of cases and Haiku in 81
 * to 88%, and Haiku was slower (2.0 s to the first word, Terra 1.4 s), so a race between the
 * two gained nothing.
 *
 * Two Terras hear each time, each on its own warm thread, and the first word wins: the other
 * stops at once. Terra's first word is fast most times but slow some times, and the two are
 * seldom slow together. In an A/B on fry (24 hearings each) the race brought p90 from 2.1 s to
 * 1.6 s, at the cost of a second turn on the plan.
 */

/** The model that hears him when Terra cannot, with no thinking and no tools. */
const FAST = "claude-haiku-5-5";

/** Only what the Claude Code process needs: no keys of the dev server's own. */
export function envOf() {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM"];
  return Object.fromEntries(
    keep.flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k] ?? ""]])),
  );
}

/**
 * What the page sent, as his message: the screenshots first, each with what it is, and the
 * rest as JSON. Each loop's crop comes first, as Clicky's does: it is what he means most.
 */
export function parts(text: string): readonly Part[] {
  const { images, ...context } = JSON.parse(text) as {
    images?: { screen?: string; circled?: readonly string[] };
  };
  return [
    ...(images?.circled ?? []).flatMap((url, i): Part[] => [
      { type: "text", text: `Loop ${String(i + 1)}, close up: what he circled.` },
      { type: "image", url },
    ]),
    ...(images?.screen === undefined
      ? []
      : ([
          {
            type: "text",
            text: "The page and the panel as he saw them, with his strokes in blue.",
          },
          { type: "image", url: images.screen },
        ] as const)),
    { type: "text", text: JSON.stringify(context) },
  ];
}

/** What the page sent, as his message to Claude Code. */
export async function* words(text: string): AsyncGenerator<SDKUserMessage> {
  const content = parts(text).map((part) => {
    if (part.type === "text") return part;
    const [, type = "image/jpeg", data = ""] = /^data:([^;]+);base64,(.*)$/s.exec(part.url) ?? [];
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: type as "image/jpeg", data },
    };
  });
  yield {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    origin: { kind: "human" },
  };
}

export const HEAR = `Henrik reviews a web app by eye. He pointed at the page and spoke; a slower agent does what he asks. You only say back, at once, what he asks for, so he sees a wrong hearing before the agent starts. One line of at most twelve words, starting with a verb, in plain words: "Make the pill green once it is approved." For a question, say what he asks: "Asks what 'Waiting on approvers' means." Never answer it, never say how you read his pointing, and never add anything else.`;

/**
 * Haiku's ears, for when Terra cannot hear: a Claude Code process, started ahead after its
 * first use, so a hearing does not wait for it to start. Each hearing takes it, and the next
 * one starts at once. `close` ends the one that waits, with the dev server.
 */
export function haiku() {
  const spare = () => {
    const stop = new AbortController();
    const warm = startup({
      options: {
        model: FAST,
        thinking: { type: "disabled" },
        tools: [],
        settingSources: [],
        systemPrompt: HEAR,
        persistSession: false,
        includePartialMessages: true,
        env: envOf(),
        abortController: stop,
      },
    });
    // A spare that fails to start fails the hearing that takes it, not the dev server.
    warm.catch(() => undefined);
    return { warm, stop };
  };
  let next: { readonly warm: Promise<WarmQuery>; readonly stop: AbortController } | undefined;
  return {
    /** Starts the process for the first hearing. */
    ready: () => {
      next ??= spare();
    },
    /**
     * Streams what it heard him ask for, in one line: `on` gets the line so far as its words
     * come, so it shows from the first word.
     */
    hear: async (text: string, signal: AbortSignal, on: (line: string) => void) => {
      const { warm, stop } = next ?? spare();
      next = spare();
      const end = () => stop.abort();
      signal.addEventListener("abort", end, { once: true });
      try {
        let said = "";
        for await (const message of (await warm).query(words(text))) {
          if (message.type !== "stream_event") continue;
          const { event } = message;
          if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
          said += event.delta.text;
          const line = said.trimStart().split("\n")[0]?.trimEnd() ?? "";
          if (line !== "") on(line);
          // One line only: what comes after it is more than he needs.
          if (said.trimStart().includes("\n")) break;
        }
      } finally {
        signal.removeEventListener("abort", end);
        stop.abort();
      }
    },
    close: () => {
      next?.stop.abort();
      next = undefined;
    },
  };
}

/** Who said the line. */
export type Ear = "terra" | "haiku";

export interface EarsOptions {
  /** Which model hears: Terra with Haiku as backup, or Haiku alone. */
  readonly use?: "terra" | "haiku";
  readonly warn?: (why: string) => void;
}

/** How many Terras race for each hearing. */
const RACE = 2;

/**
 * Asks each Terra, and streams the line of the first one that says a word; the others stop.
 * Rejects only when all of them fail before a word.
 */
async function race(
  terras: readonly ReturnType<typeof terra>[],
  input: readonly Part[],
  signal: AbortSignal,
  on: (line: string) => void,
) {
  const stops = terras.map(() => new AbortController());
  const stopAll = () => {
    for (const stop of stops) stop.abort();
  };
  signal.addEventListener("abort", stopAll, { once: true });
  let winner: number | undefined;
  try {
    const runs = await Promise.allSettled(
      terras.map((one, i) =>
        one.hear(input, stops[i]?.signal ?? signal, (line) => {
          if (winner === undefined) {
            winner = i;
            for (const [j, stop] of stops.entries()) if (j !== i) stop.abort();
          }
          if (winner === i) on(line);
        }),
      ),
    );
    if (winner !== undefined || signal.aborted) return;
    const failed = runs.find((run) => run.status === "rejected");
    throw failed?.reason ?? new Error("Terra said nothing");
  } finally {
    signal.removeEventListener("abort", stopAll);
  }
}

/**
 * The ears. `hear` streams the line: `on` gets the line so far, and who says it, as its words
 * come. The text is the page's JSON, as the agent gets it.
 */
export function ears({ use = "terra", warn = () => undefined }: EarsOptions = {}) {
  const terras = Array.from({ length: RACE }, () => terra(HEAR));
  const backup = haiku();
  return {
    ready: () => {
      if (use === "terra") for (const one of terras) one.ready();
      else backup.ready();
    },
    hear: async (text: string, signal: AbortSignal, on: (line: string, ear: Ear) => void) => {
      if (use === "haiku") return backup.hear(text, signal, (line) => on(line, "haiku"));
      let said = false;
      try {
        await race(terras, parts(text), signal, (line) => {
          said = true;
          on(line, "terra");
        });
      } catch (error) {
        if (said || signal.aborted) return;
        warn(`Terra did not hear, so Haiku does: ${String(error)}`);
        await backup.hear(text, signal, (line) => on(line, "haiku"));
      }
    },
    close: () => {
      for (const one of terras) one.close();
      backup.close();
    },
  };
}
