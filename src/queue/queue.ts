/*
 * The queue of what needs the reviewer: the agent's remarks, in the order that keeps his
 * context and keeps little work open (docs/vision.md, "Next: one key for what needs
 * Henrik"). Plain data and pure functions, so the workshop and the tests drive the same
 * rules, and the overlay can take them over.
 *
 * - Next goes forward on the trail of remarks shown, and past its end to the queue's first.
 * - Back goes back on the trail, settled remarks too.
 * - A remark that the reviewer leaves with no annotation of his own on it settles.
 * - A remark that he annotated waits, and settles when the agent's answers to it settle.
 */

/** What a remark asks of the reviewer. */
export type Kind = "look" | "answer" | "choice" | "question";

/** One beat of a remark's walk: the agent's cursor goes to an element and says why. */
export interface Beat {
  /** The element: a CSS selector. */
  readonly target: string;
  /** What the element is, in words, for when it cannot be found. */
  readonly name?: string;
  /** What the voice says. */
  readonly say: string;
  /** The few words that the agent's note on the element shows; the voice says the rest. */
  readonly note?: string;
  /** What the cursor draws on the element while it speaks. */
  readonly draw?: "circle" | "underline";
  /** The reviewer's turn: the walk waits for his own click on the element. The cursor never
   * clicks. */
  readonly turn?: boolean;
  /** A variant to preview while the beat shows. It ends with the beat; only the reviewer
   * keeps a variant. */
  readonly peek?: string;
}

export interface Remark {
  readonly id: string;
  readonly kind: Kind;
  /** The page that it is on, as the app names its path. */
  readonly page: string;
  /** The element that it is about: a CSS selector. */
  readonly target: string;
  readonly title: string;
  readonly text?: string;
  /** For an answer: the annotations that it answers. */
  readonly answers?: readonly string[];
  /** For a choice: the variants, by their labels. */
  readonly variants?: readonly string[];
  /** For a question: the answers to choose from. */
  readonly options?: readonly string[];
  /** When the agent wrote it, in ms. */
  readonly at: number;
  /** The agent's cursor shows the remark: where to look, and what to try. */
  readonly walk?: readonly Beat[];
}

export interface Annotation {
  readonly id: string;
  readonly page: string;
  readonly target: string;
  readonly text: string;
  /** The remark that showed when the reviewer wrote it. */
  readonly on: string | undefined;
  readonly at: number;
}

export interface Queue {
  readonly remarks: readonly Remark[];
  readonly annotations: readonly Annotation[];
  /** The remarks that are settled, by their IDs. */
  readonly settled: readonly string[];
  /** The variant each choice keeps, and the answer each question has. */
  readonly picks: Readonly<Record<string, string>>;
  /** The remarks shown, in the order shown; Back walks it. */
  readonly trail: readonly string[];
  /** Where on the trail the reviewer is; -1 before the first. */
  readonly at: number;
}

export const empty = (): Queue => ({
  remarks: [],
  annotations: [],
  settled: [],
  picks: {},
  trail: [],
  at: -1,
});

export const remarkOf = (q: Queue, id: string | undefined) =>
  id === undefined ? undefined : q.remarks.find((r) => r.id === id);

/** The remark that shows. */
export const current = (q: Queue) => remarkOf(q, q.trail[q.at]);

export const isSettled = (q: Queue, id: string) => q.settled.includes(id);

/** The agent's answer to an annotation, if it came. */
export const answerOf = (q: Queue, annotation: string) =>
  q.remarks.find((r) => r.answers?.includes(annotation));

/** His annotations that wait on the agent: no answer came yet. */
export const waiting = (q: Queue) => q.annotations.filter((a) => answerOf(q, a.id) === undefined);

/** His annotations written on a remark. */
export const annotationsOn = (q: Queue, remark: string) =>
  q.annotations.filter((a) => a.on === remark);

/** Where a remark stands in the queue: the page that shows first, answers before new
 * remarks, then the oldest. An answer to come stands where the answer will. */
function rank(
  q: Queue,
  item: { readonly page: string; readonly answer: boolean; readonly at: number },
) {
  const here = current(q);
  return [
    // Finish where he is: the page that shows comes first.
    here !== undefined && item.page === here.page ? 0 : 1,
    // Finish before starting: answers before new remarks.
    item.answer ? 0 : 1,
    item.at,
  ];
}

function byRank(x: readonly number[], y: readonly number[]) {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

const rankOf = (q: Queue, r: Remark) =>
  rank(q, { page: r.page, answer: r.kind === "answer", at: r.at });

/** The open remarks that he has not seen, in the order Next takes them. */
export function order(q: Queue): readonly Remark[] {
  return [...q.remarks]
    .filter((r) => !isSettled(q, r.id) && !q.trail.includes(r.id))
    .sort((a, b) => byRank(rankOf(q, a), rankOf(q, b)));
}

/** One place in the queue ahead: a remark, or the agent's answer to an annotation, which
 * has not come yet. */
export type Ahead =
  | { readonly kind: "remark"; readonly remark: Remark }
  | { readonly kind: "answer"; readonly annotation: Annotation };

/**
 * The queue after the remark that shows, as Next takes it: open remarks on the trail ahead,
 * then the rest in order. An answer still with the agent stands where it will come, so a
 * remark that he annotated comes back into the queue at its place.
 */
export function ahead(q: Queue): readonly Ahead[] {
  const trail = q.trail
    .slice(q.at + 1)
    .map((id) => remarkOf(q, id))
    .filter((r): r is Remark => r !== undefined && !isSettled(q, r.id))
    .map((remark): Ahead => ({ kind: "remark", remark }));
  const rest = [
    ...order(q).map((remark) => ({
      item: { kind: "remark", remark } satisfies Ahead,
      rank: rankOf(q, remark),
    })),
    ...waiting(q).map((annotation) => ({
      item: { kind: "answer", annotation } satisfies Ahead,
      rank: rank(q, { page: annotation.page, answer: true, at: Number.MAX_SAFE_INTEGER }),
    })),
  ].sort((a, b) => byRank(a.rank, b.rank));
  return [...trail, ...rest.map((r): Ahead => r.item)];
}

/** The remarks that he saw before the one that shows, and those settled before, the last
 * first. */
export function seen(q: Queue): readonly Remark[] {
  const ids = [...q.trail.slice(0, Math.max(q.at, 0)).reverse(), ...q.settled];
  return [...new Set(ids)]
    .filter((id) => id !== current(q)?.id)
    .map((id) => remarkOf(q, id))
    .filter((r) => r !== undefined);
}

/** The remarks left: open, and not waiting on the agent. */
export const left = (q: Queue) =>
  q.remarks.filter(
    (r) =>
      !isSettled(q, r.id) && !annotationsOn(q, r.id).some((a) => answerOf(q, a.id) === undefined),
  ).length;

/** Every remark is settled and nothing waits: the journey ships. */
export const done = (q: Queue) =>
  q.remarks.length > 0 && q.remarks.every((r) => isSettled(q, r.id)) && waiting(q).length === 0;

/** Settle a remark, and the remarks that its answers close: a remark settles once each
 * annotation on it has a settled answer. */
function settle(q: Queue, id: string): Queue {
  if (isSettled(q, id)) return q;
  let next: Queue = { ...q, settled: [...q.settled, id] };
  for (const annotation of remarkOf(q, id)?.answers ?? []) {
    const on = q.annotations.find((a) => a.id === annotation)?.on;
    if (on === undefined || isSettled(next, on)) continue;
    const closed = annotationsOn(next, on).every((a) => {
      const answer = answerOf(next, a.id);
      return answer !== undefined && isSettled(next, answer.id);
    });
    if (closed) next = settle(next, on);
  }
  return next;
}

/** What leaving the remark that shows does: it settles unless he annotated it. Gives the
 * remarks that settled, for the toast. */
function leave(q: Queue): { readonly queue: Queue; readonly settled: readonly string[] } {
  const here = current(q);
  if (here === undefined || isSettled(q, here.id)) return { queue: q, settled: [] };
  if (annotationsOn(q, here.id).length > 0) return { queue: q, settled: [] };
  if (here.kind === "choice" && q.picks[here.id] === undefined) return { queue: q, settled: [] };
  if (here.kind === "question" && q.picks[here.id] === undefined) return { queue: q, settled: [] };
  const queue = settle(q, here.id);
  return { queue, settled: queue.settled.filter((id) => !q.settled.includes(id)) };
}

export interface Move {
  readonly queue: Queue;
  /** The remarks that the move settled. */
  readonly settled: readonly string[];
}

/** Next: the next open remark on the trail ahead, else the queue's first remark. A settled
 * remark ahead is passed over, so Next goes back from the past to what needs him. With
 * nothing to show, the reviewer stays, and the remark that he leaves still settles. */
export function next(q: Queue): Move {
  const { queue, settled } = leave(q);
  const open = queue.trail.findIndex((id, i) => i > queue.at && !isSettled(queue, id));
  if (open !== -1) return { queue: { ...queue, at: open }, settled };
  const first = order(queue)[0];
  if (first === undefined) return { queue, settled };
  return {
    queue: { ...queue, trail: [...queue.trail, first.id], at: queue.trail.length },
    settled,
  };
}

/** Back: the remark shown before, settled or not. */
export function back(q: Queue): Move {
  if (q.at <= 0) return { queue: q, settled: [] };
  const { queue, settled } = leave(q);
  return { queue: { ...queue, at: queue.at - 1 }, settled };
}

/** Show one remark now, as a click on its pin does. */
export function show(q: Queue, id: string): Move {
  if (current(q)?.id === id || remarkOf(q, id) === undefined) return { queue: q, settled: [] };
  const { queue, settled } = leave(q);
  const kept = queue.trail.slice(0, queue.at + 1).filter((t) => t !== id);
  return { queue: { ...queue, trail: [...kept, id], at: kept.length }, settled };
}

/** Settle the remark that shows now, and go on. */
export function settleNow(q: Queue): Move {
  const here = current(q);
  if (here === undefined) return { queue: q, settled: [] };
  const settled = settle(q, here.id);
  const moved = next(settled);
  return {
    queue: moved.queue,
    settled: [...settled.settled.filter((id) => !q.settled.includes(id)), ...moved.settled],
  };
}

/** Take settles back, as undo does. */
export const unsettle = (q: Queue, ids: readonly string[]): Queue => ({
  ...q,
  settled: q.settled.filter((id) => !ids.includes(id)),
});

export const annotate = (q: Queue, annotation: Annotation): Queue => ({
  ...q,
  annotations: [...q.annotations, annotation],
});

/** The agent writes a remark. */
export const arrive = (q: Queue, remark: Remark): Queue => ({
  ...q,
  remarks: [...q.remarks, remark],
});

/** Keep a variant, or answer a question. */
export const pick = (q: Queue, remark: string, value: string): Queue => ({
  ...q,
  picks: { ...q.picks, [remark]: value },
});
