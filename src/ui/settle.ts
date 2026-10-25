/*
 * A settle shows that it took, then the walk goes on: the light turns green and a check
 * draws in its corner, and only then does the session hear of it. While that motion plays,
 * and until the next step shows with its light in place, another settle does nothing. So a
 * held or quick y never settles a step that the reviewer has not seen. Plain data, no DOM,
 * so the rule is tested alone.
 */

/** How long the motion plays before the walk goes on, in ms. */
export const SETTLE_MS = 400;

/** How long a light that the walk took back to a step shows its old look, in ms, before it
 * turns: undo runs the settle's motion backwards. */
export const TURN_MS = 160;

/** How long a light waits to turn, in ms, so one that never shows does not keep waiting. */
export const TURN_WAIT = 3000;

/** Where the settle is. */
export type Settling =
  | { readonly kind: "still" }
  /** The motion plays on the step: its light turns green, and its check draws. */
  | { readonly kind: "playing"; readonly step: string }
  /** The settle went to the session from the step shown, as `from` names it; the walk goes
   * on to a step that does not show yet. */
  | { readonly kind: "going"; readonly from: string };

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
  /** Starts a settle's motion on the step. False while another settle plays, or while its
   * next step does not show yet: then this settle does nothing. */
  readonly begin: (step: string) => boolean;
  /** The settle went to the session from the step that shows, named by `from`. */
  readonly sent: (from: string) => void;
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
    begin: (step) => {
      if (state.kind !== "still") return false;
      set({ kind: "playing", step });
      return true;
    },
    sent: (from) => set({ kind: "going", from }),
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
