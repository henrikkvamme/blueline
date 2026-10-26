import { Effect } from "effect";
import type { ReactNode } from "react";
import { STORED } from "../io/stored";
import type { JourneyInfo, StepInfo } from "../types";

/*
 * The parts on the page that have variants (variants.tsx), as plain data: the variant and
 * state each part shows, the reviewer's verdicts on its variants, and the part that is
 * lifted. It is read and tested outside React; the parts and the walk only call it.
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
  /** The open note, to show in the lift. */
  readonly panel?: ReactNode;
  /** How wide the tools' panel is, docked at the window's right: the lift stands in the room
   * beside it. None on a phone, or while the panel is hidden. */
  readonly docked?: number;
}

export interface Lifting {
  readonly id: string;
  readonly judge: Judge;
}

export interface Parts {
  readonly shown: Readonly<Record<string, Shown>>;
  readonly verdicts: Readonly<Record<string, Verdicts>>;
  /** The variants with a note, by the part's name. */
  readonly noted: Readonly<Record<string, readonly string[]>>;
  readonly instances: readonly Instance[];
  readonly lifting: Lifting | undefined;
}

const KEY = `${STORED}.part.`;
export const NO_VERDICTS: Verdicts = { kept: [], dropped: [] };
const NOTHING: Shown = { variant: undefined, state: undefined };

let now: Parts = { shown: {}, verdicts: {}, noted: {}, instances: [], lifting: undefined };
const listeners = new Set<() => void>();
/** Each part's variants, by its name, from the call that made it: known before it shows. */
const declared = new Map<string, readonly string[]>();
const set = (next: Partial<Parts>) => {
  now = { ...now, ...next };
  for (const l of listeners) l();
};

const stored = (name: string): string | undefined => {
  try {
    return localStorage.getItem(`${KEY}${name}`) ?? undefined;
  } catch {
    return undefined;
  }
};

/** The variant a part shows: the one shown last, unless the reviewer deleted it; then the
 * first one left. With every variant deleted, the first. */
export function variantOf(labels: readonly string[], shown: Shown, verdicts: Verdicts): string {
  const left = labels.filter((l) => !verdicts.dropped.includes(l));
  const wanted = shown.variant;
  return wanted !== undefined && left.includes(wanted) ? wanted : (left[0] ?? labels[0] ?? "");
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
  const variants = instance.labels.filter((l) => !verdicts.dropped.includes(l)).length;
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
  current: () => now,
  /** Says a part's variants, as `variants` makes the part. */
  declare: (name: string, labels: readonly string[]) => void declared.set(name, labels),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  shown: (name: string): Shown =>
    now.shown[name] ??
    (stored(name) === undefined ? NOTHING : { variant: stored(name), state: undefined }),
  verdicts: (name: string): Verdicts => now.verdicts[name] ?? NO_VERDICTS,
  /** Shows a variant and state on every part of this name. The variant stays across reloads;
   * the state is the review's for now. */
  show: (name: string, shown: Shown) => {
    try {
      if (shown.variant !== undefined) localStorage.setItem(`${KEY}${name}`, shown.variant);
    } catch {
      // A browser without storage shows the variant until the page reloads.
    }
    set({ shown: { ...now.shown, [name]: shown } });
  },
  judge: (verdicts: Readonly<Record<string, Verdicts>>) => set({ verdicts }),
  mark: (noted: Readonly<Record<string, readonly string[]>>) => set({ noted }),
  add: (instance: Instance) => {
    const same = now.instances.find((i) => i.name === instance.name);
    if (same !== undefined && same.labels.join("\n") !== instance.labels.join("\n"))
      Effect.runFork(
        Effect.logError(
          `Two parts are named "${instance.name}" with other variants: ${same.labels.join(", ")}; and ${instance.labels.join(", ")}. Give one of them another name.`,
        ),
      );
    set({ instances: [...now.instances.filter((i) => i.id !== instance.id), instance] });
    return () =>
      set({
        instances: now.instances.filter((i) => i.id !== instance.id),
        lifting: now.lifting?.id === instance.id ? undefined : now.lifting,
      });
  },
  /** The part in or around the elements, of this name if one is given. With no name, the
   *  parts named in `others` are not the elements' own: they are other steps' parts. */
  under: (
    elements: readonly Element[],
    name?: string,
    others: readonly string[] = [],
  ): Instance | undefined =>
    now.instances.find((i) => {
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
  /** The part is down on the page again. */
  land: () => set({ lifting: undefined }),
};

/**
 * How many variants the step has to look at: its part's not deleted, also while the part is
 * on another page, else the step's own.
 */
export function variantsOn(step: StepInfo, journey: JourneyInfo | undefined): number {
  const name = partOn(step, journey)?.name ?? step.part;
  const labels = name === undefined ? undefined : declared.get(name);
  if (name !== undefined && labels !== undefined) {
    const dropped = parts.verdicts(name).dropped;
    return labels.filter((l) => !dropped.includes(l)).length;
  }
  return step.variants?.length ?? 0;
}

/** The part with variants (part/variants.tsx) in the step's target, while it shows. A step
 * that names no part does not take a part another step of its journey names: the part round
 * its target is that step's, as when `apply` took a step's own part away. */
export const partOn = (step: StepInfo | undefined, journey: JourneyInfo | undefined) =>
  step === undefined
    ? undefined
    : parts.on(
        step.target ?? [],
        step.part,
        (journey?.steps ?? []).flatMap((s) => (s.part === undefined ? [] : [s.part])),
      );
