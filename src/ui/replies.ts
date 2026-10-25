import type { Note } from "../notes/note";
import type { SessionActor } from "../session/machine";
import { nextNews } from "../session/replies";

/** Opens a reply where it is: its step, whose chat the panel shows. */
export function openReply(actor: SessionActor, at: number) {
  const { context } = actor.getSnapshot();
  if (context.preview) actor.send({ type: "preview" });
  actor.send({ type: "panel", shown: true });
  actor.send(
    context.active
      ? { type: "jump", at }
      : { type: "start", journey: context.journey, at, fresh: false },
  );
}

/** Opens a reply on a page's chat: the panel off a step, or on a step, the panel with the
 * page's chat, so the walk stays where it is. Only a reply on this page opens; another page's
 * is not here. */
export function openPlaceReply(actor: SessionActor, note: Note) {
  const { context } = actor.getSnapshot();
  if (note.step !== context.place) return;
  if (context.preview) actor.send({ type: "preview" });
  actor.send({ type: "panel", shown: true });
  if (context.active) actor.send({ type: "chat", to: "page" });
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

/** Folds the tree, so the panel shows what a row or a reply opened: the step, or the page's
 * chat on a phone, whose sheet the tree would fill. */
export function foldTree(actor: SessionActor) {
  if (actor.getSnapshot().context.tree) actor.send({ type: "tree", open: false });
}
