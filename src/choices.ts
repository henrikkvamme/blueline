import { useEffect, useId, useSyncExternalStore } from "react";
import { registry, type DevChoice } from "./core/registry";
import type { DevCommand } from "./types";

export { registry, type DevChoice } from "./core/registry";

/*
 * What the page shows can be chosen: a design or a state to step through. A page names its
 * choices and commands while it shows; the `v` picker and a step's variants pick from them,
 * and the `?` menu lists the commands. The registry is plain data (core/registry.ts); these
 * hooks only add and remove a React page's entries.
 */

/** Names the page's choices and commands while it shows; read again after each render, so a
 * choice shows its current value. In a build the registry only holds them: nothing reads
 * them, as the dev tools are not loaded. */
export function useDevTools(
  choices: readonly DevChoice[],
  commands: readonly DevCommand[] = [],
): void {
  const id = useId();
  useEffect(() => {
    registry.set(id, { choices, commands });
  });
  useEffect(() => () => registry.remove(id), [id]);
}

export const useRegistry = () => useSyncExternalStore(registry.subscribe, registry.current);
