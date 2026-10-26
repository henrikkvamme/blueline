import { DateTime } from "effect";
import { createActor, type SnapshotFrom } from "xstate";
import { linkedReview } from "../io/link";
import { keptOf, loadKept, saveKept } from "../io/storage";
import { isKept } from "../notes/note";
import { pageJourney, pageParts, placeId } from "../part/page";
import { parts, type Verdicts } from "../part/store";
import { liveMachine, shapesOf } from "../session/actors";
import type { SessionActor, sessionMachine } from "../session/machine";
import type { DevAdapter, DevInfo, DevShift, JourneyInfo, StepInfo } from "../types";

/*
 * The review session on a page, without a view: the session machine wired to the app's
 * adapter, the page's own journey of its parts, the review a link opens, the kept review in
 * the browser's storage, and the verdicts the parts show. A view (ui/devtools.tsx) starts it,
 * draws it and stops it; it imports nothing of React.
 */

export type Snapshot = SnapshotFrom<typeof sessionMachine>;

/** The time now, in ms. */
export const now = () => DateTime.toEpochMillis(DateTime.nowUnsafe());

export const journeyIn = (s: Snapshot, adapter: DevInfo): JourneyInfo | undefined =>
  adapter.journeys.find((j) => j.id === s.context.journey) ?? adapter.journeys[0];

export const stepIn = (s: Snapshot, adapter: DevInfo): StepInfo | undefined =>
  journeyIn(s, adapter)?.steps[s.context.at];

/** The verdicts on each part, by its name: the step's own over the other steps'. */
const verdictsIn = (s: Snapshot, adapter: DevInfo): Readonly<Record<string, Verdicts>> => {
  const step = stepIn(s, adapter)?.id;
  const others = Object.entries(s.context.feedback)
    .filter(([id]) => id !== step)
    .map(([, f]) => f.parts ?? {});
  return Object.assign({}, ...others, step === undefined ? {} : s.context.feedback[step]?.parts);
};

/** The variants with a note on the step, by the part's name. */
const notedIn = (s: Snapshot, adapter: DevInfo): Readonly<Record<string, readonly string[]>> => {
  const step = stepIn(s, adapter)?.id;
  const noted: Record<string, string[]> = {};
  for (const n of s.context.notes) {
    const on = n.pin?.variant;
    if (on === undefined || n.step !== step || !isKept(n)) continue;
    (noted[on.part] ??= []).push(on.variant);
  }
  return noted;
};

export interface SessionOptions<C> {
  readonly adapter: DevAdapter<C>;
  /** Where the browser keeps the review. */
  readonly storageKey: string;
  /** The page's path now: each path has its own notes and its own journey of parts. */
  readonly path: () => string;
  /** Shows what changes while a step's world changes, or nothing. */
  readonly shift: (shift: DevShift | undefined) => void;
}

export interface Session {
  readonly actor: SessionActor;
  /** The app's adapter, with the journey of the parts on this page. */
  readonly info: () => DevInfo;
  /** Calls `listener` when `info` changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Reads the page's path again, as after the app went to another page. */
  readonly moved: () => void;
  /** Stops the session: the machine, and what it listens to. */
  readonly dispose: () => void;
}

/** Starts the review session on the page. */
export function startSession<C>({ adapter, storageKey, path, shift }: SessionOptions<C>): Session {
  // The page's path, then the parts on it that have variants: the page's own review has a
  // step for each. The machine runs the adapter's code; the view reads `info`.
  const pageOf = () => [path(), ...pageParts(parts.current().instances)].join("\n");
  const infoOf = (page: string): DevInfo => {
    const [place, ...names] = page.split("\n");
    return { ...adapter, journeys: [...adapter.journeys, pageJourney(names, place)] };
  };
  let page = pageOf();
  let info = infoOf(page);
  const listeners = new Set<() => void>();

  const actor = createActor(liveMachine({ adapter, shift, path }), {
    input: {
      kept: loadKept(storageKey),
      journeys: shapesOf(info.journeys),
      now: now(),
      place: placeId(path()),
    },
  });

  // A link from the agent starts its review, on its step, and leaves the address clean. Its
  // journey may be the page's own, whose parts come after the session starts.
  const followLink = () => {
    const linked = linkedReview(location.href);
    if (linked === undefined) return;
    const journey = info.journeys.find((j) => j.id === linked.journey);
    if (journey === undefined) return;
    history.replaceState(history.state, "", linked.rest);
    const at = Math.max(
      0,
      journey.steps.findIndex((s) => s.id === linked.step),
    );
    actor.send({ type: "start", journey: linked.journey, at, fresh: false });
  };

  // The parts on the page show the reviewer's verdicts, as a deleted variant leaves the
  // lift, and which variants have a note.
  let judged = "";
  let marked = "";
  const judge = (s: Snapshot) => {
    const verdicts = verdictsIn(s, info);
    const key = JSON.stringify(verdicts);
    if (key !== judged) {
      judged = key;
      parts.judge(verdicts);
    }
    const noted = notedIn(s, info);
    const marks = JSON.stringify(noted);
    if (marks !== marked) {
      marked = marks;
      parts.mark(noted);
    }
  };

  /** The page's path or parts changed: the session gets the journeys and the place again. */
  const moved = () => {
    const next = pageOf();
    if (next === page) return;
    const place = next.split("\n")[0];
    const wasPlace = page.split("\n")[0];
    page = next;
    info = infoOf(next);
    actor.send({ type: "journeys", journeys: shapesOf(info.journeys) });
    if (place !== wasPlace) actor.send({ type: "place", place: placeId(place ?? "") });
    judge(actor.getSnapshot());
    followLink();
    for (const l of listeners) l();
  };

  actor.start();
  const kept = actor.subscribe((s) => saveKept(storageKey, keptOf(s.context)));
  const judging = actor.subscribe(judge);
  judge(actor.getSnapshot());
  const partsMoved = parts.subscribe(moved);
  followLink();

  return {
    actor,
    info: () => info,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    moved,
    dispose: () => {
      partsMoved();
      judging.unsubscribe();
      kept.unsubscribe();
      actor.stop();
      listeners.clear();
    },
  };
}
