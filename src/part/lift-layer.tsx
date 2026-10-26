import { isValidElement, useState, useSyncExternalStore } from "react";
import { Lift } from "./lift";
import { StillLifted } from "./still-lift";
import { AS_IT_IS, hugs, NO_VERDICTS, parts, rectOf, variantOf, type Instance } from "./store";

/*
 * The lift, for the part the store says is lifted, or a step's own variants as stills
 * (still-lift.tsx): the tools draw it, and the workshop. It reads the part from the store,
 * so the part's own code (variants.tsx) only draws its copies in the lift's slots, in its
 * own React.
 */

export function LiftLayer() {
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  const lifting = now.lifting;
  if (lifting?.still !== undefined)
    return (
      <StillLifted
        key={lifting.id}
        id={lifting.id}
        still={lifting.still}
        docked={lifting.judge.docked}
      />
    );
  const instance = now.instances.find((i) => i.id === lifting?.id);
  if (lifting === undefined || instance === undefined) return null;
  return <Lifted key={lifting.id} instance={instance} />;
}

/** The lift of one part, from the moment it rose. */
function Lifted({ instance }: { readonly instance: Instance }) {
  const { id, name, labels, states: names } = instance;
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  // Where the part stood when it rose, and whether it takes its content's size; the page
  // keeps its box while the lift is up.
  const [rose] = useState(() => {
    const node = instance.node();
    return node === null ? undefined : { from: rectOf(node), hug: hugs(node) };
  });
  const lifting = now.lifting;
  if (lifting?.id !== id || rose === undefined) return null;
  const shown = now.shown[name] ?? parts.shown(name);
  const verdicts = now.verdicts[name] ?? NO_VERDICTS;
  const variant = variantOf(labels, shown, verdicts);
  const state = shown.state !== undefined && names.includes(shown.state) ? shown.state : undefined;
  const stateAt = (at: number) => (at === 0 ? undefined : names[at - 1]);
  const { judge } = lifting;
  return (
    <Lift
      id={id}
      title={name}
      variants={labels.filter((l) => !verdicts.dropped.includes(l))}
      states={[AS_IT_IS, ...names]}
      start={{ variant, state: state === undefined ? 0 : names.indexOf(state) + 1 }}
      from={rose.from}
      hug={rose.hug}
      onDrop={judge.drop}
      onUndo={judge.undo}
      onNote={
        judge.note === undefined
          ? undefined
          : (at) => judge.note?.({ variant: at.variant, state: stateAt(at.state) })
      }
      note={isValidElement(judge.panel) ? judge.panel : undefined}
      noted={now.noted[name] ?? []}
      onPut={(at) => parts.show(name, { variant: at.variant, state: stateAt(at.state) })}
      where={() => {
        const node = instance.node();
        return node === null ? undefined : rectOf(node);
      }}
      onDone={parts.land}
      docked={judge.docked}
    />
  );
}
