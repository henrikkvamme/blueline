import { shared } from "./shared";

/*
 * One overlay owns the page. `mount` and `<DevTools>` each claim it when they start, from
 * any copy of Blueline: the newest claim wins, and the overlay before it yields and takes
 * its tools off the page. The app's dev parts reach the review through the owner, so they
 * keep working whichever overlay has the page.
 */

export interface Owner {
  /** Starts the review of a journey on its step at `at`; `fresh` starts it from new. */
  readonly start: (journey: string, at: number, fresh: boolean) => void;
  /** Takes this overlay's tools off the page: a newer one has it. */
  readonly yield: () => void;
}

const page = shared("owner", (): { current: Owner | undefined } => ({ current: undefined }));

/** Gives the page to the overlay; the one before yields. Returns its release, which leaves
 * the page without an owner when the overlay still has it. */
export function claim(owner: Owner): () => void {
  const before = page.current;
  page.current = owner;
  before?.yield();
  return () => {
    if (page.current === owner) page.current = undefined;
  };
}

/** The overlay that has the page, if any. */
export const owner = (): Owner | undefined => page.current;
