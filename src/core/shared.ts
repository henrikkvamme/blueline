/*
 * State that every copy of Blueline on a page shares: the parts and the registry. An app can
 * load Blueline twice, as the overlay's bundle and as its React parts, or a module again on
 * a code change; each copy finds the state on a global key, so the parts one copy adds are
 * the parts the other sees. The state's shape has a protocol number: a copy with another
 * number keeps its own state, and says so once.
 */

/** The protocol of the shared state. Change it with any change to the state's shape. */
export const PROTOCOL = 1;

interface Cell<T> {
  readonly protocol: number;
  readonly state: T;
}

const isCell = <T>(value: unknown): value is Cell<T> =>
  typeof value === "object" &&
  value !== null &&
  "protocol" in value &&
  typeof value.protocol === "number" &&
  "state" in value;

const told = new Set<string>();

/** The state shared by the name, made by `make` if no copy made it yet. */
export function shared<T extends object>(name: string, make: () => T): T {
  const key = Symbol.for(`blueline.${name}`);
  const found: unknown = Reflect.get(globalThis, key);
  if (isCell<T>(found) && found.protocol === PROTOCOL) return found.state;
  const state = make();
  if (found === undefined) {
    const cell: Cell<T> = { protocol: PROTOCOL, state };
    Reflect.set(globalThis, key, cell);
  } else if (!told.has(name)) {
    told.add(name);
    console.warn(
      `Two versions of Blueline are on the page: their ${name} are apart. Load one version.`,
    );
  }
  return state;
}
