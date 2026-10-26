import type { DevCommand } from "../types";
import { shared } from "./shared";

/*
 * What the page shows can be chosen: a design or a state to step through. A page names its
 * choices and commands while it shows; the `v` picker and a step's variants pick from them,
 * and the `?` menu lists the commands. The registry is plain data, so it is read and tested
 * outside a view; choices.ts adds and removes a React page's entries.
 */

export interface DevChoice {
  readonly name: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly choose: (option: string) => void;
}

interface Entry {
  readonly choices: readonly DevChoice[];
  readonly commands: readonly DevCommand[];
}

interface State {
  entries: ReadonlyMap<string, Entry>;
  all: { readonly choices: readonly DevChoice[]; readonly commands: readonly DevCommand[] };
  readonly listeners: Set<() => void>;
}

/** Every copy of Blueline on the page shares the registry (shared.ts). */
const state = shared("registry", (): State => ({
  entries: new Map(),
  all: { choices: [], commands: [] },
  listeners: new Set(),
}));
const { listeners } = state;

function publish(next: ReadonlyMap<string, Entry>) {
  state.entries = next;
  const list = [...next.values()];
  state.all = {
    choices: list.flatMap((e) => e.choices),
    commands: list.flatMap((e) => e.commands),
  };
  for (const l of listeners) l();
}

export const registry = {
  set: (id: string, entry: Entry) => publish(new Map([...state.entries, [id, entry]])),
  remove: (id: string) => publish(new Map([...state.entries].filter(([key]) => key !== id))),
  current: () => state.all,
  choice: (name: string) => state.all.choices.find((c) => c.name === name),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
