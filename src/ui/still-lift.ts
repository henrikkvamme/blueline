import { stepIn } from "../core/session";
import type { SessionActor } from "../session/machine";
import { copyVariants, rectOfAll, targetsOf, type StepWalk } from "../part/still-walk";
import { parts, type Judge, type StillLift } from "../part/store";
import type { DevInfo } from "../types";

/*
 * `v` on a step whose variants change the page, and not a part: the walk shows each variant
 * for now (the machine's `peek`), the lift copies it (part/still-walk.ts), and then shows the
 * copies (part/still-lift.tsx). The lift goes as soon as the walk leaves the step.
 */

type Snapshot = ReturnType<SessionActor["getSnapshot"]>;

/** Where the walk was when the lift rose: it goes when the walk is anywhere else. */
interface Place {
  readonly journey: string;
  readonly at: number;
  readonly run: number;
}

const there = (s: Snapshot, place: Place) =>
  s.status === "active" &&
  s.context.active &&
  s.context.journey === place.journey &&
  s.context.at === place.at &&
  s.context.run === place.run;

/** The walk on the step, for the copying. */
function walkOn(
  actor: SessionActor,
  step: string,
  labels: readonly string[],
  place: Place,
  selectors: readonly string[],
): StepWalk {
  return {
    peek: (label) => actor.send({ type: "peek", step, label }),
    ready: (label, signal) =>
      new Promise<void>((resolve, reject) => {
        let done = false;
        const end = (error?: Error) => {
          if (done) return;
          done = true;
          sub.unsubscribe();
          signal.removeEventListener("abort", abort);
          if (error === undefined) resolve();
          else reject(error);
        };
        const abort = () => end(new Error("Stopped"));
        const check = (s: Snapshot) => {
          if (!there(s, place)) return end(new Error("The walk left the step"));
          const { context } = s;
          const index = label === undefined ? (context.variants[step] ?? 0) : labels.indexOf(label);
          if (!s.matches({ review: { on: "ready" } }) || context.entered?.variant !== index) return;
          const trouble = context.trouble[step];
          end(trouble === undefined ? undefined : new Error(trouble));
        };
        const sub = actor.subscribe(check);
        signal.addEventListener("abort", abort, { once: true });
        check(actor.getSnapshot());
      }),
    targets: () => targetsOf(selectors),
  };
}

/** Lifts the step's own variants: copies each, then shows the copies. */
export function liftStill(actor: SessionActor, info: DevInfo, judge: Judge) {
  const snapshot = actor.getSnapshot();
  const step = stepIn(snapshot, info);
  const labels = step?.variants?.map((v) => v.label) ?? [];
  if (step === undefined || labels.length < 2) return;
  const { journey, at, run } = snapshot.context;
  const place: Place = { journey, at, run };
  const id = `still:${step.id}`;
  const selectors = step.target ?? [];
  const walk = walkOn(actor, step.id, labels, place, selectors);
  const stopping = new AbortController();
  const going = new AbortController();
  const first = labels[snapshot.context.variants[step.id] ?? 0] ?? labels[0] ?? "";
  const ours = () => parts.current().lifting?.id === id;
  // The lift goes when the walk leaves the step, and the copying stops.
  const watch = actor.subscribe((s) => {
    if (there(s, place)) return;
    going.abort();
    stopping.abort();
    if (ours()) parts.land();
  });
  // The lift went: as Close or Use put it down.
  const landed = parts.subscribe(() => {
    if (ours()) return;
    watch.unsubscribe();
    landed();
  });
  let lift: StillLift = {
    title: step.title,
    labels,
    first,
    from: rectOfAll(walk.targets()),
    copying: { label: first, at: 0 },
    copies: undefined,
    problem: undefined,
    stop: () => {
      stopping.abort();
      // A problem shown has nothing to stop: Close puts the lift down.
      if (lift.problem !== undefined && ours()) parts.land();
    },
    use: (label) => {
      actor.send({ type: "showVariant", step: step.id, label });
      return walk.ready(label, going.signal).catch(() => undefined);
    },
    where: () => rectOfAll(walk.targets()),
  };
  const show = (next: Partial<StillLift>) => {
    lift = { ...lift, ...next };
    if (!going.signal.aborted) parts.liftStill(id, judge, lift);
  };
  show({});
  void copyVariants({
    walk,
    labels,
    first,
    stop: stopping.signal,
    gone: going.signal,
    onCopying: (copying) => show({ copying }),
  }).then((copied) => {
    if (!ours()) return;
    if (copied.kind === "copied") show({ copies: copied.copies, from: rectOfAll(walk.targets()) });
    else if (copied.kind === "too big")
      show({ problem: "The step's target is too big to copy. Press j and k to see its variants." });
    // The page goes back to the first variant, which clears the step's mark, so the bar
    // keeps the reason until the reviewer closes it.
    else if (copied.kind === "failed") show({ problem: copied.reason });
    else parts.land();
  });
}
