import { OWN } from "../core/root";
import { stillOf, type Still } from "./still";

/*
 * Copying a step's own variants for the lift (still-lift.tsx): the walk shows each variant
 * on the page for now, Blueline copies the step's target once it is ready (still.ts), and the
 * walk goes back to the variant the step keeps. The walk's part is an interface, so the
 * copying is the same for the tools and for a test.
 */

/** What the copying needs of the walk, on the step it copies. */
export interface StepWalk {
  /** Shows the variant for now; with none, the one the step keeps. */
  readonly peek: (label: string | undefined) => void;
  /** Ends once the walk is ready on the variant, none for the one the step keeps, with no
   * trouble. Fails with the step's trouble, or when the walk leaves the step. */
  readonly ready: (label: string | undefined, signal: AbortSignal) => Promise<void>;
  /** The step's target on the page now. */
  readonly targets: () => readonly Element[];
}

export type Copied =
  | { readonly kind: "copied"; readonly copies: ReadonlyMap<string, Still> }
  /** The reviewer stopped it, or the walk left the step. */
  | { readonly kind: "stopped" }
  | { readonly kind: "too big" }
  | { readonly kind: "failed"; readonly reason: string };

/** How long the copying waits for the target's animations to end, at most. */
const ANIMATIONS_MS = 1000;

class Stopped extends Error {}

/** Ends with the promise, or fails once the signal aborts. */
function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Stopped());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Stopped());
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Waits until the page has drawn the variant: two frames, the fonts, and the targets'
 * animations that end, for a second at most. */
async function drawn(targets: readonly Element[], signal: AbortSignal) {
  await until(frame(), signal);
  await until(frame(), signal);
  await until(document.fonts.ready, signal);
  const ending = targets
    .flatMap((t) => t.getAnimations({ subtree: true }))
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity));
  await until(
    Promise.race([
      Promise.all(ending.map((a) => a.finished.catch(() => undefined))),
      sleep(ANIMATIONS_MS),
    ]),
    signal,
  );
}

/**
 * Copies each variant: the first as the page shows it, then each other in the step's order.
 * Then the walk goes back to the variant the step keeps, and the window to where it was
 * scrolled, unless the walk left the step (`gone`). `stop` stops it at once, and the walk
 * goes back too.
 */
export async function copyVariants({
  walk,
  labels,
  first,
  stop,
  gone,
  onCopying,
}: {
  readonly walk: StepWalk;
  readonly labels: readonly string[];
  readonly first: string;
  readonly stop: AbortSignal;
  readonly gone: AbortSignal;
  /** Says which variant it copies, by its place in the order; none once it goes back. */
  readonly onCopying: (
    copying: { readonly label: string; readonly at: number } | undefined,
  ) => void;
}): Promise<Copied> {
  const scroll = { x: window.scrollX, y: window.scrollY };
  const order = [first, ...labels.filter((l) => l !== first)];
  const copies = new Map<string, Still>();
  let copied: Copied = { kind: "copied", copies };
  try {
    for (const [at, label] of order.entries()) {
      onCopying({ label, at });
      if (label !== first) walk.peek(label);
      await until(walk.ready(label === first ? undefined : label, stop), stop);
      await drawn(walk.targets(), stop);
      const still = stillOf(walk.targets());
      if (still === undefined) {
        copied = { kind: "too big" };
        break;
      }
      copies.set(label, still);
    }
  } catch (error) {
    copied =
      error instanceof Stopped || stop.aborted || gone.aborted
        ? { kind: "stopped" }
        : { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
  onCopying(undefined);
  walk.peek(undefined);
  if (!gone.aborted) {
    try {
      await walk.ready(undefined, gone);
      window.scrollTo(scroll.x, scroll.y);
    } catch (error) {
      // The page may still show another variant: the lift says so, and has no copies.
      if (!gone.aborted)
        copied = {
          kind: "failed",
          reason: `${first} did not come back: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
  }
  return gone.aborted && copied.kind === "copied" ? { kind: "stopped" } : copied;
}

/** The elements the selectors find on the page, without Blueline's own and without one
 * inside another. */
export function targetsOf(selectors: readonly string[]): readonly Element[] {
  const found = selectors
    .flatMap((selector) => {
      try {
        return [...document.querySelectorAll(selector)];
      } catch {
        return [];
      }
    })
    .filter((el) => el.closest(OWN) === null);
  const unique = [...new Set(found)];
  return unique.filter((el) => !unique.some((other) => other !== el && other.contains(el)));
}

/** The rectangle round the elements; the window's for none. */
export function rectOfAll(elements: readonly Element[]): DOMRect {
  if (elements.length === 0) return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  const rects = elements.map((el) => el.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return new DOMRect(
    left,
    top,
    Math.max(...rects.map((r) => r.right)) - left,
    Math.max(...rects.map((r) => r.bottom)) - top,
  );
}
