import { DateTime } from "effect";
import { createActor, type SnapshotFrom } from "xstate";
import { linkedReview } from "../io/link";
import { keptOf, loadKept, saveKept } from "../io/storage";
import { isKept } from "../notes/note";
import { PAGE_JOURNEY, pageJourney, pageParts, placeId } from "../part/page";
import { parts, type Verdicts } from "../part/store";
import { liveMachine, shapesOf } from "../session/actors";
import type { SessionActor, sessionMachine } from "../session/machine";
import { placed, withPlace } from "../session/state";
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
  /** Why the app's config is not used, for the tree. */
  readonly problem?: string | undefined;
}

export interface Session {
  readonly actor: SessionActor;
  /** The app's adapter, with the journey of the parts on this page. */
  readonly info: () => DevInfo;
  /** What changes while a step's world changes, or nothing. */
  readonly shift: () => DevShift | undefined;
  /** Calls `listener` when `info` or `shift` changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Starts the review of a journey, on its step by the step's ID or on its first. Says
   *  whether the journey is there. */
  readonly start: (journey: string, step?: string) => boolean;
  /** Reads the page's path again, as after the app went to another page. */
  readonly moved: () => void;
  /** Stops the session: the machine, and what it listens to. */
  readonly dispose: () => void;
}

/** Starts the review session on the page. */
export function startSession<C>({
  adapter,
  storageKey,
  path,
  problem,
}: SessionOptions<C>): Session {
  // The page's path, then the parts on it that have variants: the page's own review has a
  // step for each. The machine runs the adapter's code; the view reads `info`.
  const pageOf = () => [path(), ...pageParts(parts.current().instances)].join("\n");
  const infoOf = (page: string): DevInfo => {
    const [place, ...names] = page.split("\n");
    return {
      ...adapter,
      journeys: [...adapter.journeys, pageJourney(names, place)],
      ...(problem === undefined ? {} : { problem }),
    };
  };
  let page = pageOf();
  let info = infoOf(page);
  let shown: DevShift | undefined;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of listeners) l();
  };
  const shift = (next: DevShift | undefined) => {
    shown = next;
    changed();
  };

  // A link from the agent starts its review, on its step. It is read before the machine
  // starts: the kept review's step would open its own page first, and the link would go with
  // the address it had. While a link to a journey the app has waits, the kept review opens no
  // step; the page's own journey waits for its parts.
  const known = (journey: string) =>
    journey === PAGE_JOURNEY || adapter.journeys.some((j) => j.id === journey);
  const first = linkedReview(location.href);
  // A link to a journey the app does not have is not kept, so a later link still counts.
  let linked = first !== undefined && known(first.journey) ? first : undefined;
  const waits = linked !== undefined;
  const stored = placed(loadKept(storageKey), shapesOf(info.journeys));
  const machine = liveMachine({ adapter, shift, path });
  const actor = createActor(machine, {
    input: {
      kept: waits ? { ...stored, active: false } : stored,
      journeys: shapesOf(info.journeys),
      now: now(),
      place: placeId(path()),
    },
  });

  const start = (id: string, step?: string) => {
    const journey = info.journeys.find((j) => j.id === id);
    if (journey === undefined) return false;
    const at = Math.max(
      0,
      journey.steps.findIndex((s) => s.id === step),
    );
    actor.send({ type: "start", journey: id, at, fresh: false });
    return true;
  };

  // The link's journey may be the page's own, whose parts come after the session starts. Once
  // it starts, the address is clean. The app can also go to a page with a link, which then
  // counts before the one kept from the start.
  const followLink = () => {
    const there = linkedReview(location.href);
    const link = there !== undefined && known(there.journey) ? there : linked;
    if (link === undefined || !info.journeys.some((j) => j.id === link.journey)) return;
    linked = undefined;
    history.replaceState(history.state, "", link.rest);
    start(link.journey, link.step);
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
    // The same page may have a link in its query now.
    if (next === page) return followLink();
    const place = next.split("\n")[0];
    const wasPlace = page.split("\n")[0];
    page = next;
    info = infoOf(next);
    actor.send({ type: "journeys", journeys: shapesOf(info.journeys) });
    if (place !== wasPlace) actor.send({ type: "place", place: placeId(place ?? "") });
    judge(actor.getSnapshot());
    followLink();
    changed();
  };

  actor.start();
  const kept = actor.subscribe((s) =>
    saveKept(storageKey, withPlace(keptOf(s.context), s.context.journeys)),
  );
  const judging = actor.subscribe(judge);
  judge(actor.getSnapshot());
  const partsMoved = parts.subscribe(moved);
  followLink();

  return {
    actor,
    info: () => info,
    shift: () => shown,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    start,
    moved,
    dispose: () => {
      partsMoved();
      judging.unsubscribe();
      kept.unsubscribe();
      const { entered, opening } = actor.getSnapshot().context;
      actor.stop();
      machine.dispose(opening ?? entered);
      listeners.clear();
    },
  };
}
