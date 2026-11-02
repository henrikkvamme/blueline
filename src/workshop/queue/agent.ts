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
  /** What a fast model heard him ask for, in one line, before the agent answers. */
  | { readonly type: "heard"; readonly text: string; readonly ear: string }
  | { readonly type: "show"; readonly id: string; readonly beats: readonly Beat[] }
  | { readonly type: "annotate"; readonly target: string; readonly text: string }
  | { readonly type: "done"; readonly text: string }
  | { readonly type: "failed"; readonly why: string };

/**
 * Draws the page as he sees it, onto a canvas in px of the viewport: the app gives it, so the
 * package carries no screenshot code. With none, the agent gets words and boxes alone.
 */
export type Capture = () => Promise<HTMLCanvasElement>;

let capture: Capture | undefined;

/** The app gives the workshop its way to draw the page. */
export function setCapture(to: Capture) {
  capture = to;
}

/** The page with his strokes on it, and a close crop of each loop, as Clicky sends them. */
export async function screenshots(
  loops: readonly string[],
  mouse: { readonly x: number; readonly y: number },
): Promise<{ readonly screen: string; readonly circled: readonly string[] } | undefined> {
  if (capture === undefined) return undefined;
  let page: HTMLCanvasElement;
  try {
    page = await capture();
  } catch {
    return undefined;
  }
  const scale = page.width / innerWidth;
  const pen = page.getContext("2d");
  if (pen === null) return undefined;
  pen.save();
  pen.scale(scale, scale);
  pen.translate(-scrollX, -scrollY);
  pen.strokeStyle = "#4a6cf7";
  pen.lineWidth = 3;
  pen.lineCap = "round";
  pen.lineJoin = "round";
  for (const d of loops) pen.stroke(new Path2D(d));
  pen.restore();
  // Where his mouse was when he let go: a ring, as a cursor shows.
  pen.beginPath();
  pen.arc(mouse.x * scale, mouse.y * scale, 7 * scale, 0, Math.PI * 2);
  pen.lineWidth = 2.5 * scale;
  pen.strokeStyle = "#4a6cf7";
  pen.stroke();
  const circled = loops.flatMap((d) => {
    const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0).map((x) => x - scrollX);
    const ys = n.filter((_, i) => i % 2 === 1).map((y) => y - scrollY);
    if (xs.length === 0) return [];
    const pad = 28;
    const left = Math.max(0, Math.min(...xs) - pad);
    const top = Math.max(0, Math.min(...ys) - pad);
    const width = Math.min(innerWidth, Math.max(...xs) + pad) - left;
    const height = Math.min(innerHeight, Math.max(...ys) + pad) - top;
    if (width < 8 || height < 8) return [];
    const crop = document.createElement("canvas");
    crop.width = Math.round(width * scale);
    crop.height = Math.round(height * scale);
    crop
      .getContext("2d")
      ?.drawImage(
        page,
        left * scale,
        top * scale,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
    return [crop.toDataURL("image/png")];
  });
  // The whole view, at most 1440 px wide: enough to read, small enough to send.
  const fit = Math.min(1, 1440 / page.width);
  const screen = document.createElement("canvas");
  screen.width = Math.round(page.width * fit);
  screen.height = Math.round(page.height * fit);
  screen.getContext("2d")?.drawImage(page, 0, 0, screen.width, screen.height);
  return { screen: screen.toDataURL("image/jpeg", 0.85), circled };
}

/** An element that the agent may point at, as the page shows it now. */
interface Seen {
  readonly selector: string;
  readonly name: string | undefined;
  readonly where: "page" | "panel";
  readonly text: string;
  readonly html: string;
  /** Left, top, width and height, in px of the viewport. */
  readonly box: readonly [number, number, number, number];
}

const markupOf = (element: HTMLElement) =>
  element.outerHTML
    .replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>")
    .replace(/\s+/g, " ")
    .slice(0, 900);

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
        text: [
          element.innerText,
          ...[...element.querySelectorAll("input, textarea")].map((i) =>
            i instanceof HTMLInputElement || i instanceof HTMLTextAreaElement ? i.value : "",
          ),
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140),
        html: markupOf(element),
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
