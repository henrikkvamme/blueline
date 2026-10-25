/*
 * A state of a part is a patch over the props the page gives it: only what differs. A plain
 * object in the patch merges into the prop's object; anything else, as an array, a function
 * or a React element, takes the prop's place.
 */

/** What a state changes in a part's props. */
export type Patch<P> = {
  readonly [K in keyof P]?: P[K] extends (...args: never[]) => unknown
    ? P[K]
    : P[K] extends readonly unknown[]
      ? P[K]
      : P[K] extends object
        ? Patch<P[K]>
        : P[K];
};

const isPlain = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || "$$typeof" in value) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function over(props: unknown, patch: unknown): unknown {
  if (!isPlain(props) || !isPlain(patch)) return patch === undefined ? props : patch;
  const out: Record<string, unknown> = { ...props };
  for (const [key, value] of Object.entries(patch)) out[key] = over(props[key], value);
  return out;
}

/** The props with the patch over them. The props stay as they are. */
export function merge<P>(props: P, patch: Patch<P> | undefined): P;
export function merge(props: unknown, patch: unknown): unknown {
  return over(props, patch);
}
