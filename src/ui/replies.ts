import type { Note } from "../notes/note";
import type { SessionActor } from "../session/machine";
import { nextNews } from "../session/replies";
import { isPhone } from "./touch";

/** Opens a reply where it is: its step, whose chat has it. */
export function openReply(actor: SessionActor, at: number) {
  const { context } = actor.getSnapshot();
  if (context.preview) actor.send({ type: "preview" });
  actor.send(
    context.active
      ? { type: "jump", at }
      : { type: "start", journey: context.journey, at, fresh: false },
  );
}

/** Opens a reply on a page's chat: the page's card, or on a step, its card with the page's
 * chat, so the walk stays where it is. Only a reply on this page opens; another page's is
 * not here. */
export function openPlaceReply(actor: SessionActor, note: Note) {
  const { context } = actor.getSnapshot();
  if (note.step !== context.place) return;
  if (context.preview) actor.send({ type: "preview" });
  actor.send(context.active ? { type: "chat", to: "page" } : { type: "page", open: true });
}

/** Opens the next reply in the journey, if there is one. */
export function openNextReply(actor: SessionActor) {
  const { context } = actor.getSnapshot();
  const journey = context.journeys.find((j) => j.id === context.journey) ?? context.journeys[0];
  const steps = journey?.steps.map((s) => s.id) ?? [];
  const next = nextNews(context.notes, steps, context.at);
  if (next !== undefined) openReply(actor, next.at);
  return next !== undefined;
}

/** On a phone the open sidebar covers the cards, so a reply or a chat opened from it or from
 * the bar closes it. The desktop keeps it. */
export function leaveSidebar(actor: SessionActor) {
  if (isPhone() && actor.getSnapshot().context.sidebar) actor.send({ type: "sidebar" });
}
