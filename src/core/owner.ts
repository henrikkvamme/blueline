import { parts } from "../part/store";
import { shared } from "./shared";

/*
 * One overlay owns the page. `mount` and `<DevTools>` each claim it when they start, from
 * any copy of Blueline: the newest claim wins, and the overlay before it yields and takes
 * its tools off the page. The app's dev parts reach the review through the owner, so they
 * keep working whichever overlay has the page. A lifted part is the owner's: its note and
 * its verdicts go to the owner's session, so the part lands when the owner changes or goes.
 */

export interface Owner {
  /** Starts the review of a journey on its step at `at`; `fresh` starts it from new. */
  readonly start: (journey: string, at: number, fresh: boolean) => void;
  /** Takes this overlay's tools off the page: a newer one has it. */
  readonly yield: () => void;
}

type Start = Parameters<Owner["start"]>;

const page = shared("owner", (): { current: Owner | undefined; waiting: Start | undefined } => ({
  current: undefined,
  waiting: undefined,
}));

/** Lands the lifted part, if one is up. */
function land() {
  if (parts.current().lifting !== undefined) parts.land();
}

/** Gives the page to the overlay; the one before yields. A start that came while no
 * overlay had the page goes to it. Returns its release, which leaves the page without an
 * owner when the overlay still has it. */
export function claim(owner: Owner): () => void {
  const before = page.current;
  if (before !== undefined) land();
  page.current = owner;
  before?.yield();
  const waiting = page.waiting;
  page.waiting = undefined;
  if (waiting !== undefined) owner.start(...waiting);
  return () => {
    if (page.current !== owner) return;
    page.current = undefined;
    land();
  };
}

/** Starts the review on the overlay that has the page, or on the next one to claim it: an
 * app's part can ask before the overlay has started. */
export function startReview(...start: Start): void {
  if (page.current === undefined) page.waiting = start;
  else page.current.start(...start);
}

/** The overlay that has the page, if any. */
export const owner = (): Owner | undefined => page.current;
