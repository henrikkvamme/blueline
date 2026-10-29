import { shared } from "../core/shared";
import { STORED } from "../io/stored";
import type { JourneyInfo, StepInfo } from "../types";
import type { Still } from "./still";

/*
 * The parts on the page that have variants (variants.tsx), as plain data: the variant and
 * state each part shows, the reviewer's verdicts on its variants, and the part that is
 * lifted. It is read and tested outside React; the parts and the walk only call it. Every
 * copy of Blueline on the page shares it (core/shared.ts).
 */

/** What a part shows: a variant by its label, and a state by its name, none for the page's. */
export interface Shown {
  readonly variant: string | undefined;
  readonly state: string | undefined;
}

/** The reviewer's verdicts on a part's variants: the ones to keep and the ones to delete. */
export interface Verdicts {
  readonly kept: readonly string[];
  readonly dropped: readonly string[];
}

/** One part on the page. Parts with the same name are one design choice and show the same. */
export interface Instance {
  readonly id: string;
  readonly name: string;
  readonly labels: readonly string[];
  /** The names of its states, out of the page's own. */
  readonly states: readonly string[];
  /** The part's element: its children are what the page shows of it. */
  readonly node: () => Element | null;
}

/** What the lift does with the reviewer's verdicts: the walk, or the workshop, keeps them. */
export interface Judge {
  readonly drop: (label: string) => void;
  readonly undo: () => void;
  /** Opens the note on a variant in a state, to write in, where the walk takes notes. */
  readonly note?: (shown: Shown & { readonly variant: string }) => void;
  /** The open note, to show in the lift: an element of the view's, which the store only
   * keeps (part/variants.tsx draws it). */
  readonly panel?: unknown;
  /** How wide the tools' panel is, docked at the window's right: the lift stands in the room
   * beside it. None on a phone, or while the panel is hidden. */
  readonly docked?: number;
}

/** The lift of a step whose variants change the page, and not a part: Blueline copies each
 * variant as a still (still.ts), and the lift shows the copies. */
export interface StillLift {
  /** The step's title. */
  readonly title: string;
  /** The step's variants, in its order. */
  readonly labels: readonly string[];
  /** The variant the page showed when the lift rose. */
  readonly first: string;
  /** Where the step's target was on the page. */
  readonly from: DOMRect;
  /** The variant being copied, while Blueline copies them. */
  readonly copying: { readonly label: string; readonly at: number } | undefined;
  /** The copies, by the variant's label, once each is copied. */
  readonly copies: ReadonlyMap<string, Still> | undefined;
  /** Why there are no copies, as a target too big to copy. */
  readonly problem: string | undefined;
  /** Stops the copying, and the page goes back to the first variant. */
  readonly stop: () => void;
  /** Shows the variant on the page as the step's own, and ends when the page shows it. */
  readonly use: (label: string) => Promise<void>;
  /** Where the step's target is on the page now. */
  readonly where: () => DOMRect | undefined;
}

export interface Lifting {
  readonly id: string;
  readonly judge: Judge;
  /** For a step's own variants: their copies, and no part in the store. */
  readonly still?: StillLift;
}

/** One option the lift shows: a variant of the part in a state, by the state's place, 0 for
 *  the page's own. */
export interface StageOption {
  readonly slot: string;
  readonly variant: string;
  readonly state: number;
}

/** What the lift shows, and the host whose slots show it: the lifted part draws a copy of
 *  itself for each option, as a light child of the host (lift.tsx). */
export interface Stage {
  readonly id: string;
  readonly host: Element;
  readonly options: readonly StageOption[];
}

export interface Parts {
  readonly shown: Readonly<Record<string, Shown>>;
  readonly verdicts: Readonly<Record<string, Verdicts>>;
  /** The variants with a note, by the part's name. */
  readonly noted: Readonly<Record<string, readonly string[]>>;
  readonly instances: readonly Instance[];
  readonly lifting: Lifting | undefined;
  readonly stage: Stage | undefined;
}

/** The first state in the lift's column: the part as the page gives it. */
export const AS_IT_IS = "As it is";

const KEY = `${STORED}.part.`;
/** Blueline's own hosts on the page (ui/host.ts). */
const HOST = "[data-blueline-host]";
export const NO_VERDICTS: Verdicts = { kept: [], dropped: [] };
const NOTHING: Shown = { variant: undefined, state: undefined };

interface State {
  now: Parts;
  readonly listeners: Set<() => void>;
  /** Each part's variants, by its name, from the call that made it: known before it shows. */
  readonly declared: Map<string, readonly string[]>;
}

const state = shared("parts", (): State => ({
  now: {
    shown: {},
    verdicts: {},
    noted: {},
    instances: [],
    lifting: undefined,
    stage: undefined,
  },
  listeners: new Set(),
  declared: new Map(),
}));
const { listeners, declared } = state;
const set = (next: Partial<Parts>) => {
  state.now = { ...state.now, ...next };
  for (const l of listeners) l();
};

const stored = (name: string): string | undefined => {
  try {
    return localStorage.getItem(`${KEY}${name}`) ?? undefined;
  } catch {
    return undefined;
  }
};

/** The variants of a part left to choose from: the one the reviewer kept, as a kept part is
 * decided, else the ones the reviewer did not delete. Reopening the step takes the keep back. */
export function leftOf(labels: readonly string[], verdicts: Verdicts): readonly string[] {
  const kept = labels.filter((l) => verdicts.kept.includes(l));
  return kept.length > 0 ? kept : labels.filter((l) => !verdicts.dropped.includes(l));
}

/** The variant a part shows: the one shown last, unless it is not left (`leftOf`); then the
 * first one left. With every variant deleted, the first. */
export function variantOf(labels: readonly string[], shown: Shown, verdicts: Verdicts): string {
  const left = leftOf(labels, verdicts);
  const wanted = shown.variant;
  return wanted !== undefined && left.includes(wanted) ? wanted : (left[0] ?? labels[0] ?? "");
}

/**
 * The variants the panel lists for a step, and the one the page shows: the part's variants
 * left (`leftOf`), else the step's own. `from` says which. None when fewer
 * than two are left, as there is nothing to choose.
 */
export function variantRows(
  part: { readonly labels: readonly string[] } | undefined,
  shown: Shown,
  verdicts: Verdicts,
  own: { readonly labels: readonly string[]; readonly at: number },
):
  | { readonly labels: readonly string[]; readonly at: number; readonly from: "part" | "own" }
  | undefined {
  const left = part === undefined ? [] : leftOf(part.labels, verdicts);
  if (part !== undefined && left.length > 1)
    return {
      labels: left,
      at: left.indexOf(variantOf(part.labels, shown, verdicts)),
      from: "part",
    };
  return own.labels.length > 1 ? { ...own, from: "own" } : undefined;
}

/** The verdicts after the reviewer deletes a variant. */
export function dropped(was: Verdicts, variant: string): Verdicts {
  const without = (list: readonly string[]) => list.filter((v) => v !== variant);
  return { kept: without(was.kept), dropped: [...without(was.dropped), variant] };
}

/** The verdicts after the reviewer settles the step on a variant: the one to keep. */
export const keptOn = (was: Verdicts, variant: string): Verdicts => ({
  kept: [variant],
  dropped: was.dropped.filter((v) => v !== variant),
});

/** How many variants of the part are left, and how many states it has besides the page's;
 * none of either when there is nothing to lift. */
export function varietyOf(instance: Instance, verdicts: Verdicts) {
  const variants = leftOf(instance.labels, verdicts).length;
  const states = instance.states.length;
  return variants > 1 || states > 0 ? { variants, states } : undefined;
}

/** The rectangle of the part's children on the page. */
export function rectOf(node: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range.getBoundingClientRect();
}

/** Whether the part takes its content's size, as a button, and not its column's, as a card. */
export function hugs(node: Element): boolean {
  const parent = node.parentElement;
  if (parent === null) return false;
  const style = getComputedStyle(parent);
  const inner = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return rectOf(node).width < inner - 1;
}

export const parts = {
  current: () => state.now,
  /** Says a part's variants, as `variants` makes the part. */
  declare: (name: string, labels: readonly string[]) => void declared.set(name, labels),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  shown: (name: string): Shown =>
    state.now.shown[name] ??
    (stored(name) === undefined ? NOTHING : { variant: stored(name), state: undefined }),
  verdicts: (name: string): Verdicts => state.now.verdicts[name] ?? NO_VERDICTS,
  /** Shows a variant and state on every part of this name. The variant stays across reloads;
   * the state is the review's for state.now. */
  show: (name: string, shown: Shown) => {
    try {
      if (shown.variant !== undefined) localStorage.setItem(`${KEY}${name}`, shown.variant);
    } catch {
      // A browser without storage shows the variant until the page reloads.
    }
    set({ shown: { ...state.now.shown, [name]: shown } });
  },
  judge: (verdicts: Readonly<Record<string, Verdicts>>) => set({ verdicts }),
  mark: (noted: Readonly<Record<string, readonly string[]>>) => set({ noted }),
  /** Adds a part on the page. A part inside one of Blueline's hosts, as one nested in a
   * lifted part's copy, is the lift's and not the page's, so it is not added. */
  add: (instance: Instance) => {
    const node = instance.node();
    if (node !== null && node.closest(HOST) !== null) return () => {};
    const same = state.now.instances.find((i) => i.name === instance.name);
    if (same !== undefined && same.labels.join("\n") !== instance.labels.join("\n"))
      console.error(
        `Two parts are named "${instance.name}" with other variants: ${same.labels.join(", ")}; and ${instance.labels.join(", ")}. Give one of them another name.`,
      );
    set({ instances: [...state.now.instances.filter((i) => i.id !== instance.id), instance] });
    return () =>
      set({
        instances: state.now.instances.filter((i) => i.id !== instance.id),
        lifting: state.now.lifting?.id === instance.id ? undefined : state.now.lifting,
        stage: state.now.stage?.id === instance.id ? undefined : state.now.stage,
      });
  },
  /** The part in or around the elements, of this name if one is given. With no name, the
   *  parts named in `others` are not the elements' own: they are other steps' parts. */
  under: (
    elements: readonly Element[],
    name?: string,
    others: readonly string[] = [],
  ): Instance | undefined =>
    state.now.instances.find((i) => {
      const node = i.node();
      if (node === null) return false;
      if (name === undefined ? others.includes(i.name) : i.name !== name) return false;
      return elements.some((e) => e.contains(node) || node.contains(e));
    }),
  /** The part in the elements the selectors find, of this name if one is given; `others` as
   *  in `under`. */
  on: (
    selectors: readonly string[],
    name?: string,
    others: readonly string[] = [],
  ): Instance | undefined =>
    parts.under(
      selectors.flatMap((selector) => [...document.querySelectorAll(selector)]),
      name,
      others,
    ),
  lift: (id: string, judge: Judge) => set({ lifting: { id, judge } }),
  /** Lifts a step's own variants, or says how their copying goes. */
  liftStill: (id: string, judge: Judge, still: StillLift) => set({ lifting: { id, judge, still } }),
  /** What the lift shows now, or nothing once it goes. */
  stage: (stage: Stage | undefined) => set({ stage }),
  /** The part is down on the page again. */
  land: () => set({ lifting: undefined, stage: undefined }),
};

/**
 * How many variants the step has to look at: its part's not deleted, also while the part is
 * on another page, else the step's own.
 */
export function variantsOn(step: StepInfo, journey: JourneyInfo | undefined): number {
  const name = partOn(step, journey)?.name ?? step.part;
  const labels = name === undefined ? undefined : declared.get(name);
  if (name !== undefined && labels !== undefined) {
    return leftOf(labels, parts.verdicts(name)).length;
  }
  return step.variants?.length ?? 0;
}

/** The parts a step of the app's journeys names, as the session gives them (`nameParts`),
 * shared as the parts are: the copy that runs the session and the one that reads a step's
 * part may be two. */
const named = shared("named", (): { parts: readonly string[] } => ({ parts: [] }));

/** Keeps the parts the app's journeys name, so a step that names none leaves them alone. */
export function nameParts(journeys: readonly JourneyInfo[]) {
  named.parts = journeys.flatMap((j) =>
    j.steps.flatMap((s) => (s.part === undefined ? [] : [s.part])),
  );
}

/** The part with variants (part/variants.tsx) in the step's target, while it shows. A step
 * that names no part does not take a part that a step of any journey names: that part is
 * the other step's, also when it shows in this step's target. The part round its target is
 * the step's only when no step names it, as when `apply` took a step's own part away. */
export const partOn = (step: StepInfo | undefined, journey: JourneyInfo | undefined) =>
  step === undefined
    ? undefined
    : parts.on(step.target ?? [], step.part, [
        ...named.parts,
        ...(journey?.steps ?? []).flatMap((s) => (s.part === undefined ? [] : [s.part])),
      ]);
