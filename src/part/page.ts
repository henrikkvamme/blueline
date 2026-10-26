import type { DevJourney } from "../types";
import type { Instance } from "./store";

/*
 * The review of the page as it is, with no journey written for it: a journey that Blueline
 * makes from the page, This page, with a step for each part with variants (variants.tsx) that
 * the page shows. It walks, settles and finishes as any journey. A step opens nothing; it
 * lights its part, and the settle keeps the variant shown. A written journey is for a flow
 * across people and pages.
 */

export const PAGE_JOURNEY = "page";

/** The step of a part: its own id, so it meets no step of a written journey. */
export const pageStepId = (part: string) => `page:${part}`;

/** The names of the parts the page can review, once each, as they come on the page. */
export function pageParts(instances: readonly Instance[]): readonly string[] {
  const names = instances.filter((i) => i.labels.length + i.states.length > 1).map((i) => i.name);
  return [...new Set(names)];
}

/** The page's review, as a journey; its steps' group names the page by its path, for the
 * agent. */
export function pageJourney<C>(names: readonly string[], path = ""): DevJourney<C> {
  return {
    id: PAGE_JOURNEY,
    title: "This page",
    steps: names.map((name) => ({
      id: pageStepId(name),
      title: name,
      look: "Is this the right look? Settle keeps the variant shown.",
      try: "Lift the part to see its variants in a row and its states in a column.",
      group: { id: PAGE_JOURNEY, title: path === "" ? "This page" : path },
      target: [`[data-blueline-part="${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`],
      part: name,
    })),
  };
}

/** A page's own place for notes, by its path: notes written with no review running. */
export const placeId = (path: string) => `place:${path}`;

/** The page's path, for a place; undefined for a step of a journey. */
export const placePath = (id: string) => (id.startsWith("place:") ? id.slice(6) : undefined);

/** The journeys as the tree and the g j picker list them: this page's review first, when the
 * page shows parts with variants, then the app's own; a journey with no steps has no row. */
export const listedJourneys = <
  J extends { readonly id: string; readonly steps: readonly unknown[] },
>(
  journeys: readonly J[],
): readonly J[] => [
  ...journeys.filter((j) => j.id === PAGE_JOURNEY && j.steps.length > 0),
  ...journeys.filter((j) => j.id !== PAGE_JOURNEY && j.steps.length > 0),
];
