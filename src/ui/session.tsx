import { useSelector } from "@xstate/react";
import { createContext, useContext } from "react";
import { now, type Snapshot } from "../core/session";
import type { Action } from "../keys/keymap";
import type { Note } from "../notes/note";
import { stepNoteId, type SessionActor } from "../session/machine";
import type { DevInfo, JourneyInfo, StepInfo } from "../types";

/*
 * What every part of the dev tools reads: the session actor and the app's adapter. The
 * parts select from the actor, so each draws again only when its own data changes.
 */

export interface Tools {
  readonly actor: SessionActor;
  readonly adapter: DevInfo;
  /** The attributes that name an element well enough to find it again, for pointing. */
  readonly anchors: readonly string[];
  /** Does what a key does, for the key menu. */
  readonly perform: (action: Action) => void;
  /** Goes to another page, by its path. */
  readonly navigate: (path: string) => void;
}

export const ToolsContext = createContext<Tools | undefined>(undefined);

export function useTools(): Tools {
  const tools = useContext(ToolsContext);
  if (tools === undefined) throw new Error("A dev tools part is outside <DevTools>");
  return tools;
}

/** The time now, for the session's events. */
export { now, type Snapshot } from "../core/session";

export function useSession<T>(select: (s: Snapshot) => T, same?: (a: T, b: T) => boolean): T {
  return useSelector(useTools().actor, select, same);
}

export const journeyOf = (adapter: DevInfo, id: string): JourneyInfo | undefined =>
  adapter.journeys.find((j) => j.id === id) ?? adapter.journeys[0];

/** The journey and the step the review is on. */
export function useStep(): {
  readonly journey: JourneyInfo | undefined;
  readonly step: StepInfo | undefined;
  readonly at: number;
} {
  const { adapter } = useTools();
  const id = useSession((s) => s.context.journey);
  const at = useSession((s) => s.context.at);
  const journey = journeyOf(adapter, id);
  return { journey, step: journey?.steps[at], at };
}

/** Where a new note goes: the step open, or the page's own place off a step or when the
 * step's card has the page's chat. */
export function useNoteStep(): string | undefined {
  const { step } = useStep();
  const onStep = useSession((s) => s.context.active && s.context.chat === "step");
  const place = useSession((s) => s.context.place);
  return onStep ? step?.id : place;
}

/** The variant the step shows, by its index, or nothing for a step without variants. */
export function useVariant(step: StepInfo | undefined) {
  const index = useSession((s) => (step === undefined ? 0 : (s.context.variants[step.id] ?? 0)));
  const label = step?.variants?.[index]?.label;
  return label === undefined ? undefined : { index, label, count: step?.variants?.length ?? 0 };
}

const sameNotes = (a: readonly Note[], b: readonly Note[]) =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/** The pointed notes not sent yet on a step or a page, in the order they were made. */
export const usePins = (step: string | undefined) =>
  useSession(
    (s) => s.context.notes.filter((n) => n.step === step && n.pin !== undefined),
    sameNotes,
  );

export const useNote = (id: string) => useSession((s) => s.context.notes.find((n) => n.id === id));

export const useStepNote = (step: string | undefined) => useNote(stepNoteId(step ?? ""));

export const useNotes = () => useSession((s) => s.context.notes);

/** Sends the step's pointed notes now, with no words: the step's own draft waits. */
export const sendPins = (actor: SessionActor, step: string) =>
  actor.send({ type: "send", id: stepNoteId(step), step, at: now(), text: "" });
