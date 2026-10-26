/*
 * A key that does a thing on a tap and peeks while held, as p for the preview: the press does
 * it at once, and a release after a hold does it back. So a tap hides the tools until the
 * next tap, and p held hides them only while it is down. Plain data, no DOM, so the rule is
 * tested alone.
 */

/** How long a press lasts before it counts as a hold, in ms. */
export const HOLD_MS = 200;

export interface HoldToggle {
  /** The key went down, at `now` in ms, and did the thing. A repeat is no new press. */
  readonly down: (now: number) => void;
  /** The key came up, or the window lost it, at `now`: whether to do the thing back, as the
   * key was held. */
  readonly up: (now: number) => boolean;
}

export function holdToggle(holdMs = HOLD_MS): HoldToggle {
  let since: number | undefined;
  return {
    down: (now) => {
      since ??= now;
    },
    up: (now) => {
      const was = since;
      since = undefined;
      return was !== undefined && now - was >= holdMs;
    },
  };
}
