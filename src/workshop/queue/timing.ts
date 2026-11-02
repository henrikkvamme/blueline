/*
 * The timing of one exchange, from the keys to the first line on screen, so the hearing evals
 * know where the time goes in real use. Each mark is ms since he pressed the keys. The dev
 * server keeps each trace (evals/hearing/live.jsonl) and each exchange as a take
 * (evals/hearing/takes/); `node examples/review-demo/evals/report.ts` sums the traces.
 *
 * The marks, in order:
 * - press: the keys went down, or Enter in the typed box (then there is no audio);
 * - mic: the microphone records;
 * - release: the keys came up;
 * - words: the speech-to-text sent back his words;
 * - sent: the page asked the agent;
 * - heard: the first word of the fast line came;
 * - painted: that word is on screen;
 * - agent: the agent's first act on the page.
 */

export type Mark = "press" | "mic" | "release" | "words" | "sent" | "heard" | "painted" | "agent";

export interface Trace {
  readonly id: string;
  readonly at: number;
  readonly typed: boolean;
  readonly marks: Partial<Record<Mark, number>>;
  /** Who said the fast line. */
  ear?: string;
  said?: string;
  line?: string;
}

let current: Trace | undefined;
let audio: Blob | undefined;
let context: unknown;
let sendTimer = 0;
let last: { trace: Trace; audio: Blob | undefined; context: unknown } | undefined;

/** A new exchange: the keys went down, or he sent a typed question. */
export function begin(typed: boolean) {
  window.clearTimeout(sendTimer);
  if (current !== undefined) keep();
  current = {
    id: crypto.randomUUID(),
    at: performance.now(),
    typed,
    marks: { press: 0 },
  };
  audio = undefined;
  context = undefined;
}

/** Marks a moment of the current exchange; a mark that came already stays. */
export function mark(name: Mark) {
  if (current === undefined || current.marks[name] !== undefined) return;
  current.marks[name] = Math.round(performance.now() - current.at);
  if (name === "heard") {
    // Painted: after the browser drew the frame with the line.
    const trace = current;
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (trace.marks.painted === undefined)
          trace.marks.painted = Math.round(performance.now() - trace.at);
      }),
    );
  }
  if (name === "agent") sendTimer = window.setTimeout(keep, 2000);
}

/** What the current exchange said and heard. */
export function note(fields: { said?: string; line?: string; ear?: string }) {
  if (current === undefined) return;
  Object.assign(current, fields);
}

/** His audio, for a take. */
export function recorded(blob: Blob) {
  audio = blob;
}

/** What the agent got, for a take. */
export function asked(what: unknown) {
  context = what;
}

/**
 * Sends the current trace to the dev server, and saves the exchange as an eval case: his
 * audio, what the agent got and the trace. Every exchange is a take, so the evals grow from
 * real use with nothing to press.
 */
function keep() {
  const trace = current;
  if (trace === undefined) return;
  current = undefined;
  // For the browser evals, which listen for each finished trace.
  window.dispatchEvent(new CustomEvent("blueline:trace", { detail: trace }));
  void fetch("/__timing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trace),
  }).catch(() => undefined);
  last = { trace, audio, context };
  if (context === undefined) return;
  const body = new FormData();
  body.append("take", JSON.stringify({ trace, context }));
  if (audio !== undefined) body.append("audio", audio, "audio.webm");
  void fetch("/__take", { method: "POST", body }).catch(() => undefined);
}

/**
 * Tells the dev server that the last answer was wrong, and why, with his audio and what the
 * agent got. The server adds the answer as it ran, and keeps it all as feedback for the
 * answer evals (evals/answers/inbox/). Resolves to whether it was kept.
 */
export async function reportWrong(reason: string): Promise<boolean> {
  if (current !== undefined && current.marks.heard !== undefined) {
    window.clearTimeout(sendTimer);
    keep();
  }
  const body = new FormData();
  body.append(
    "feedback",
    JSON.stringify({ reason, trace: last?.trace, context: last?.context, page: location.hash }),
  );
  if (last?.audio !== undefined) body.append("audio", last.audio, "audio.webm");
  try {
    return (await fetch("/__agent/feedback", { method: "POST", body })).ok;
  } catch {
    return false;
  }
}
