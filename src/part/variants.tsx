import {
  lazy,
  Suspense,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { merge, type Patch } from "./merge";
import { hugs, NO_VERDICTS, parts, rectOf, variantOf } from "./store";

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
 * `blueline apply` (bin/channel.ts).
 */

const Lift = lazy(() => import("./lift").then((m) => ({ default: m.Lift })));

/** The first state in the column: the part as the page gives it. */
export const AS_IT_IS = "As it is";

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
    const lifting = now.lifting?.id === id ? now.lifting : undefined;
    // Where the part stood when it rose, and whether it takes its content's size.
    const [rose, setRose] = useState<{ readonly from: DOMRect; readonly hug: boolean }>();
    useLayoutEffect(
      () => parts.add({ id, name, labels, states: names, node: () => node.current }),
      [id],
    );
    useLayoutEffect(() => {
      const el = node.current;
      setRose(
        lifting === undefined || el === null ? undefined : { from: rectOf(el), hug: hugs(el) },
      );
    }, [lifting]);
    const state =
      shown.state !== undefined && names.includes(shown.state) ? shown.state : undefined;
    return (
      <>
        <span
          ref={node}
          data-blueline-part={name}
          style={{ display: "contents", visibility: lifting === undefined ? undefined : "hidden" }}
        >
          {draw(props, variant, state)}
        </span>
        {lifting !== undefined &&
          rose !== undefined &&
          createPortal(
            <Suspense fallback={null}>
              <Lift
                title={name}
                variants={labels.filter((l) => !verdicts.dropped.includes(l))}
                states={[AS_IT_IS, ...names]}
                render={(at) =>
                  draw(props, at.variant, at.state === 0 ? undefined : names[at.state - 1])
                }
                start={{ variant, state: state === undefined ? 0 : names.indexOf(state) + 1 }}
                from={rose.from}
                hug={rose.hug}
                onDrop={lifting.judge.drop}
                onUndo={lifting.judge.undo}
                onNote={
                  lifting.judge.note === undefined
                    ? undefined
                    : (at) =>
                        lifting.judge.note?.({
                          variant: at.variant,
                          state: at.state === 0 ? undefined : names[at.state - 1],
                        })
                }
                note={lifting.judge.panel}
                noted={now.noted[name] ?? []}
                onPut={(at) =>
                  parts.show(name, {
                    variant: at.variant,
                    state: at.state === 0 ? undefined : names[at.state - 1],
                  })
                }
                where={() => (node.current === null ? undefined : rectOf(node.current))}
                onDone={parts.land}
              />
            </Suspense>,
            document.body,
          )}
      </>
    );
  }
  Part.displayName = `Variants(${name})`;
  return Part;
}
