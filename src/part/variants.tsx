import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { merge, type Patch } from "./merge";
import { NO_VERDICTS, parts, variantOf } from "./store";

export type { Patch } from "./merge";

/*
 * A part of the page with variants, ways it could look, and states, what it could show:
 *
 *   export const SuggestionCard = variants("Suggestion", {
 *     "Card under the field": (p: Props) => <Card {...p} />,
 *     "Tracked change": (p: Props) => <Tracked {...p} />,
 *   }, {
 *     Accepted: { suggestion: { state: "accepted" } },
 *   });
 *
 * The result is the part's component; the page uses it as before. A build shows the first
 * variant and holds nothing of the dev tools. In development, the review's v lifts the part
 * on its step: the variants stand in a row and the states in a column, each drawn with the
 * part's own props and context, a state as a patch over the props. The reviewer keeps
 * variants with * and deletes them with d; the agent applies that to this call with
 * `blueline apply` (bin/blueline.ts).
 */

export { AS_IT_IS } from "./store";

export function variants<P extends object>(
  name: string,
  options: Readonly<Record<string, (props: P) => ReactNode>>,
  states: Readonly<Record<string, Patch<P>>> = {},
): (props: P) => ReactNode {
  const first = Object.values(options)[0];
  if (first === undefined) throw new Error(`The part "${name}" has no variants.`);
  if (!import.meta.env.DEV) return first;
  const labels = Object.keys(options);
  parts.declare(name, labels);
  const names = Object.keys(states);
  const draw = (props: P, variant: string, state: string | undefined) =>
    (options[variant] ?? first)(state === undefined ? props : merge(props, states[state]));

  function Part(props: P) {
    const id = useId();
    const node = useRef<HTMLSpanElement>(null);
    const now = useSyncExternalStore(parts.subscribe, parts.current);
    const shown = now.shown[name] ?? parts.shown(name);
    const verdicts = now.verdicts[name] ?? NO_VERDICTS;
    const variant = variantOf(labels, shown, verdicts);
    const lifted = now.lifting?.id === id;
    // The lift (lift.tsx) shows options; the part draws a copy of itself for each, in the
    // lift's slot, with its own props and context.
    const stage = now.stage?.id === id ? now.stage : undefined;
    useLayoutEffect(
      () => parts.add({ id, name, labels, states: names, node: () => node.current }),
      [id],
    );
    const state =
      shown.state !== undefined && names.includes(shown.state) ? shown.state : undefined;
    return (
      <>
        <span
          ref={node}
          data-blueline-part={name}
          style={{ display: "contents", visibility: lifted ? "hidden" : undefined }}
        >
          {draw(props, variant, state)}
        </span>
        {stage !== undefined &&
          createPortal(
            stage.options.map((o) => (
              <div key={o.slot} slot={o.slot} style={{ display: "contents" }}>
                {draw(props, o.variant, o.state === 0 ? undefined : names[o.state - 1])}
              </div>
            )),
            stage.host,
          )}
      </>
    );
  }
  Part.displayName = `Variants(${name})`;
  return Part;
}
