import { startup, type SDKUserMessage, type WarmQuery } from "@anthropic-ai/claude-agent-sdk";
import { type Part, terra } from "./terra.ts";

/*
 * The first answer: one line, about a second after he spoke, that says what he asked for, so
 * a wrong hearing shows before the agent works on it. The dev server's agent and the hearing
 * evals (evals/hearing) use this same code.
 *
 * GPT-6.1 Terra hears, on a warm Codex thread (terra.ts). Claude Haiku 5.5 with no thinking
 * hears when Terra fails, and, with `hedge`, also when Terra has said no word by then: the
 * first of the two to say a word is shown, and the other stops. Terra's slow answers take 3
 * to 5 s, about one in six, and a hedge cuts them.
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
  /** Where Codex runs. */
  readonly cwd: string;
  /** Which model hears: Terra with Haiku as backup, or one alone. */
  readonly use?: "terra" | "haiku";
  /** With Terra: ms with no word from it before Haiku hears too. None: Haiku only on failure. */
  readonly hedge?: number | undefined;
  readonly warn?: (why: string) => void;
}

/**
 * The ears. `hear` streams the line: `on` gets the line so far, and who says it, as its words
 * come. The text is the page's JSON, as the agent gets it.
 */
export function ears({ cwd, use = "terra", hedge, warn = () => undefined }: EarsOptions) {
  const first = terra(HEAR, cwd);
  const backup = haiku();
  return {
    ready: () => {
      if (use === "terra") first.ready();
      else backup.ready();
    },
    hear: async (text: string, signal: AbortSignal, on: (line: string, ear: Ear) => void) => {
      if (use === "haiku") return backup.hear(text, signal, (line) => on(line, "haiku"));
      let winner: Ear | undefined;
      const stopTerra = new AbortController();
      const stopHaiku = new AbortController();
      const stopBoth = () => {
        stopTerra.abort();
        stopHaiku.abort();
      };
      signal.addEventListener("abort", stopBoth, { once: true });
      const said = (ear: Ear) => (line: string) => {
        if (winner === undefined) {
          winner = ear;
          (ear === "terra" ? stopHaiku : stopTerra).abort();
        }
        if (winner === ear) on(line, ear);
      };
      let haikuRun: Promise<void> | undefined;
      const askHaiku = () => {
        haikuRun ??= backup.hear(text, stopHaiku.signal, said("haiku"));
        return haikuRun;
      };
      const timer =
        hedge === undefined ? undefined : setTimeout(() => void askHaiku().catch(() => {}), hedge);
      try {
        await first.hear(parts(text), stopTerra.signal, said("terra"));
      } catch (error) {
        if (winner === undefined && !signal.aborted) {
          warn(`Terra did not hear, so Haiku does: ${String(error)}`);
          await askHaiku();
        }
      } finally {
        clearTimeout(timer);
        if (winner !== "terra") await haikuRun?.catch(() => undefined);
        signal.removeEventListener("abort", stopBoth);
      }
    },
    close: () => {
      first.close();
      backup.close();
    },
  };
}
