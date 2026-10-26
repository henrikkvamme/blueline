import type { DevCommand } from "../types";

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

let entries: ReadonlyMap<string, Entry> = new Map();
let all: { readonly choices: readonly DevChoice[]; readonly commands: readonly DevCommand[] } = {
  choices: [],
  commands: [],
};
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, Entry>) {
  entries = next;
  const list = [...next.values()];
  all = { choices: list.flatMap((e) => e.choices), commands: list.flatMap((e) => e.commands) };
  for (const l of listeners) l();
}

export const registry = {
  set: (id: string, entry: Entry) => publish(new Map([...entries, [id, entry]])),
  remove: (id: string) => publish(new Map([...entries].filter(([key]) => key !== id))),
  current: () => all,
  choice: (name: string) => all.choices.find((c) => c.name === name),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
