/*
 * A swipe across the part under review shows the next or the previous variant, as h and l
 * do. A swipe must not fight the page's own scroll: it counts only when the finger moved far
 * along one axis, much more than across it, so a scroll up or down is never a swipe. Plain
 * numbers, no DOM, so the rule is tested alone.
 */

/** A point on the screen, in CSS pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How far a finger goes along the axis before a swipe counts. */
export const SWIPE_DISTANCE = 48;

/** How many times further it goes along the axis than across it. */
export const SWIPE_DOMINANCE = 1.5;

/** How near the screen's side edge a touch may start; there, iOS goes back a page. */
export const SWIPE_EDGE = 16;

/**
 * Which way a finger that went from `from` to `to` moves the variants: 1 for the next, as a
 * swipe to the left, or up on the "y" axis; -1 for the previous; none when it is not a swipe.
 */
export function swipeOf(from: Point, to: Point, axis: "x" | "y" = "x"): 1 | -1 | undefined {
  const along = axis === "x" ? to.x - from.x : to.y - from.y;
  const across = axis === "x" ? to.y - from.y : to.x - from.x;
  if (Math.abs(along) < SWIPE_DISTANCE) return undefined;
  if (Math.abs(along) < SWIPE_DOMINANCE * Math.abs(across)) return undefined;
  return along < 0 ? 1 : -1;
}

/** Whether a touch at `at` may start a swipe on a screen `width` wide: not at the side edges,
 * where the browser has its own gestures. */
export const swipeStarts = (at: Point, width: number) =>
  at.x >= SWIPE_EDGE && at.x <= width - SWIPE_EDGE;
