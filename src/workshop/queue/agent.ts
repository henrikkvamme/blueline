import type { Beat } from "../../queue/queue";
import { PANEL } from "../../ui/geometry";
import { TARGETS } from "./script";

/*
 * The page's side of the workshop's agent: what the reviewer said, pointed at and saw goes
 * to the dev server's agent, and its events come back as it works. Without the route, as in
 * a build, `ask` says so, and the workshop answers from its script.
 */

export type AgentEvent =
  | { readonly type: "status"; readonly text: string }
  | { readonly type: "show"; readonly id: string; readonly beats: readonly Beat[] }
  | { readonly type: "annotate"; readonly target: string; readonly text: string }
  | { readonly type: "done"; readonly text: string }
  | { readonly type: "failed"; readonly why: string };

/** An element that the agent may point at, as the page shows it now. */
interface Seen {
  readonly selector: string;
  readonly name: string | undefined;
  readonly where: "page" | "panel";
  readonly text: string;
  /** Left, top, width and height, in px of the viewport. */
  readonly box: readonly [number, number, number, number];
}

/** Every element that a beat can point at, that shows now: the app's, and the panel's board. */
export function elements(): readonly Seen[] {
  const found = document.querySelectorAll<HTMLElement>("[data-q], [data-board], [data-board-list]");
  return [...found].flatMap((element) => {
    const r = element.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return [];
    const { q, board } = element.dataset;
    const selector =
      q !== undefined
        ? `[data-q="${q}"]`
        : board !== undefined
          ? `[data-board="${board}"]`
          : "[data-board-list]";
    return [
      {
        selector,
        name:
          q === undefined ? (board === undefined ? "the options" : `option ${board}`) : TARGETS[q],
        where: r.left >= innerWidth - PANEL ? "panel" : "page",
        text: element.innerText.replace(/\s+/g, " ").trim().slice(0, 140),
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      },
    ];
  });
}

/**
 * Asks the agent, and calls `on` with each event as it comes. Resolves to false when there is
 * no agent to ask.
 */
export async function ask(
  context: unknown,
  on: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch("/__agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context, null, 1),
      signal,
    });
  } catch {
    return signal.aborted;
  }
  if (!response.ok || response.body === null) return false;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += value;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") on(JSON.parse(line) as AgentEvent);
    }
  } catch {
    // Aborted by new words, or the server went away: the workshop has moved on.
  }
  return true;
}

/** Tells the agent how its walk went, and what the page shows now, so it can go on from
 * there: a click may have changed the page. */
export function played(id: string, how: string, page: string) {
  void fetch("/__agent/played", {
    method: "POST",
    body: JSON.stringify({ id, how, page, elements: elements() }),
  }).catch(() => undefined);
}

/** The workshop starts again: so does the agent's session. */
export function forget() {
  void fetch("/__agent/forget", { method: "POST" }).catch(() => undefined);
}
