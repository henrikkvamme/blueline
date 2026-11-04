import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/*
 * What the page sent, as his message to Claude Code: the screenshots first, each with what it
 * is, and the rest as JSON. The agent and the map's agent run with only the environment that
 * Claude Code needs.
 */

/** A piece of his message: words, or an image as a data URL. */
export type Part =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly url: string };

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
