/*
 * A settle goes on at once: the session settles the step, and the panel shows the next step.
 * The light glides from the old part to the new one, while the old part shows a green outline
 * and a check (Light's `left`). Until the next step shows with its light in place, another
 * settle does nothing, so a burst of y never settles a step that the reviewer has not seen;
 * a held key's repeats do nothing either (keymap.ts). Plain data, no DOM, so the rule is
 * tested alone.
 */

/** How long the green outline and the check play on the part the settle left, in ms, as
 * `dt-left` in styles.css; the light glides to the next part in the same time. */
export const SETTLE_MS = 250;

/** How long a light that the walk took back to a step shows its old look, in ms, before it
 * turns: undo runs the settle's motion backwards. */
export const TURN_MS = 160;

/** How long a light waits to turn, in ms, so one that never shows does not keep waiting. */
export const TURN_WAIT = 3000;

/** Where the settle is. */
export type Settling =
  | { readonly kind: "still" }
  /** The session settled a step and went on from the step shown, as `from` names it, to a
   * step whose light is not in place yet. `step` is the step settled when it is the one
   * shown, so its part shows the settle; the tree can settle another. */
  | { readonly kind: "going"; readonly from: string; readonly step: string | undefined };

const STILL: Settling = { kind: "still" };

/** A step's light to turn from its old look: settled, or open, as undo or redo left it. */
export interface Turn {
  readonly step: string;
  /** The old look: whether the step was settled. */
  readonly settled: boolean;
}

export interface SettleGate {
  readonly current: () => Settling;
  readonly subscribe: (listener: () => void) => () => void;
  /** Whether a settle may start: not while the step the last one went on to does not show
   * yet. */
  readonly free: () => boolean;
  /** The session settled a step and went on from the step shown, named by `from`; `step`
   * when the step settled is the one shown. */
  readonly sent: (from: string, step: string | undefined) => void;
  /** A step shows, with its light in place: a settle can start again. */
  readonly shown: (key: string) => void;
  /** The walk stopped or stayed where it was: a settle can start at once. */
  readonly reset: () => void;
  /** Undo or redo took the walk to the step and changed whether it is settled: its light
   * shows the old look first, then turns. */
  readonly turn: (turn: Turn) => void;
  /** The light that waits to turn, if any. */
  readonly turning: () => Turn | undefined;
  /** The step's light has turned, or no longer waits to. */
  readonly turned: (step: string) => void;
}

export function settleGate(): SettleGate {
  let state = STILL;
  let turning: Turn | undefined = undefined;
  const listeners = new Set<() => void>();
  const set = (next: Settling) => {
    if (next === state) return;
    state = next;
    for (const l of listeners) l();
  };
  return {
    current: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    free: () => state.kind === "still",
    sent: (from, step) => set({ kind: "going", from, step }),
    shown: (key) => {
      if (state.kind === "going" && state.from !== key) set(STILL);
    },
    reset: () => set(STILL),
    turn: (turn) => {
      turning = turn;
      for (const l of listeners) l();
    },
    turning: () => turning,
    turned: (step) => {
      if (turning?.step !== step) return;
      turning = undefined;
      for (const l of listeners) l();
    },
  };
}

/**
 * Whether Enter may finish the review: only a press that comes after the finish shows. The
 * Enter that settled the last step, still held as the finish comes, does not finish too: a
 * release comes first.
 */
export interface Release {
  readonly down: () => void;
  readonly up: () => void;
  /** The finish shows now. */
  readonly shows: () => void;
  readonly free: () => boolean;
}

export function release(): Release {
  let held = false;
  let free = true;
  return {
    down: () => {
      held = true;
    },
    up: () => {
      held = false;
      free = true;
    },
    shows: () => {
      free = !held;
    },
    free: () => free,
  };
}
