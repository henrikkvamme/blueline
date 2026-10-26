import { sameBox, type Box } from "./geometry";
import { SETTLE_MS } from "./settle";

/*
 * How the light around the step's part goes from one step to the next, one frame at a time:
 * it waits while the page scrolls to the next part, glides there, or fades out and in. Each
 * frame says when the light stands on the step, so a settle can start again (settle.ts).
 * Plain data, no DOM, so the rule is tested alone; Light in overlays.tsx draws it.
 */

/** How long the light glides from one part to the next, in ms: as long as a settle's green
 * outline plays on the part it left. */
export const GLIDE_MS = SETTLE_MS;

/** How long the light waits for the page to stop scrolling to its next part, in ms, before it
 * glides there all the same. */
export const SCROLL_WAIT = 900;

/** How long the light fades out or in, in ms. */
export const FADE_MS = 150;

/** For how many frames the next part stands still before the scroll counts as done. */
export const STILL_FRAMES = 4;

/** How long a step's part may take to show, in ms, before the light leaves. */
export const PART_WAIT = 600;

/** How the light shows the part of the step `at` names, as it goes from one step to the
 * next. */
export type Motion =
  /** It stands on the part, as the part moves. */
  | { readonly kind: "on"; readonly at: string }
  /** The page scrolls to the next part: the light waits where it was. */
  | {
      readonly kind: "waiting";
      readonly at: string;
      readonly from: Box;
      readonly since: number;
      readonly last: Box;
      /** For how many frames the part has stood still. */
      readonly still: number;
    }
  /** It glides from where it was to the part. */
  | { readonly kind: "gliding"; readonly at: string; readonly from: Box; readonly start: number }
  /** It fades in on the part: the first light, one on another page, or reduced motion. */
  | { readonly kind: "fading"; readonly at: string }
  /** The step shows no part, or the walk left the page: the light fades out. */
  | { readonly kind: "gone"; readonly at: string; readonly since: number };

/** What one frame reads from the page. */
export interface Frame {
  /** The box of the step's part, while it shows. */
  readonly box: Box | undefined;
  /** The step shown, as the run and its index name it. */
  readonly at: string;
  /** Whether the step's world is open, so its part shows if it has one. */
  readonly ready: boolean;
  /** The step a settle went on from, as `at` names it. */
  readonly left: string | undefined;
  readonly now: number;
  /** Where the page is, as a router has it. */
  readonly page: string;
  readonly reduced: () => boolean;
  /** The box the light last drew round a part that showed, and on which page. */
  readonly drawn: { readonly box: Box; readonly page: string } | undefined;
}

/** Since when the step `at` names has its world open and its part does not show. Each step
 * has its own wait: one that follows a step with no part does not take over its time. */
export interface Missing {
  readonly at: string;
  readonly since: number;
}

/** What a frame does: the light's next motion, and what the light must tell or draw. */
export interface Next {
  readonly motion: Motion;
  /** Since when the step's world is open and its part does not show. */
  readonly missing: Missing | undefined;
  /** The step whose light now stands in place. */
  readonly placed?: string | undefined;
  /** Whether a new light fades in. */
  readonly fade?: boolean | undefined;
  /** Whether the light gives its soft pulse, as it arrives. */
  readonly pulse?: boolean | undefined;
  /** Whether the light draws again, as it glides. */
  readonly redraw?: boolean | undefined;
}

/** The light's next frame, from its motion and since when its part is missing. */
export function lightFrame(m: Motion, was: Missing | undefined, f: Frame): Next {
  const { box, at, ready, left, now, page, drawn } = f;
  const missing =
    ready && box === undefined ? (was?.at === at ? was : { at, since: now }) : undefined;
  const stay: Next = { motion: m, missing };
  if (box !== undefined && (m.at !== at || m.kind === "gone")) {
    // A light that fades out ends its fade first, so it fades in as a new one.
    if (m.kind === "gone" && now - m.since < FADE_MS) return stay;
    if (drawn === undefined || m.kind === "gone" || drawn.page !== page || f.reduced())
      return { motion: { kind: "fading", at }, missing, placed: at, fade: true };
    // After a settle the light goes at once, on to the part as it scrolls there.
    if (left === m.at)
      return { motion: { kind: "gliding", at, from: drawn.box, start: now }, missing };
    return {
      motion: { kind: "waiting", at, from: drawn.box, since: now, last: box, still: 0 },
      missing,
    };
  }
  if (m.kind === "waiting" && box !== undefined) {
    // The page has stopped scrolling once the part stands still for a few frames.
    const still = sameBox(m.last, box) ? m.still + 1 : 0;
    if (still < STILL_FRAMES && now - m.since < SCROLL_WAIT)
      return { motion: { ...m, last: box, still }, missing };
    return { motion: { kind: "gliding", at: m.at, from: m.from, start: now }, missing };
  }
  if (m.kind === "gliding") {
    if (now - m.start < GLIDE_MS) return { ...stay, redraw: true };
    return { motion: { kind: "on", at: m.at }, missing, placed: m.at, pulse: true };
  }
  if (box !== undefined) return stay;
  // The walk went to another page, or reduced motion is on: the light fades out, and in on
  // the next part.
  if (m.kind !== "gone" && drawn !== undefined && (drawn.page !== page || f.reduced()))
    return { motion: { kind: "gone", at: m.at, since: now }, missing };
  // The step's world is open, and its part does not show: the light leaves it, and stands in
  // place all the same, so a settle can start again. A light that left another step, as one
  // with no part either, does so too.
  if (m.kind === "gone" && m.at === at) return stay;
  if (missing !== undefined && now - missing.since > PART_WAIT)
    return { motion: { kind: "gone", at, since: now }, missing, placed: at };
  return stay;
}
