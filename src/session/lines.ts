import { handoffJourney } from "../notes/handoff";
import type { Note } from "../notes/note";
import { PAGE_JOURNEY, placePath } from "../part/page";
import type { DevJourney } from "../types";
import type { Context, Post } from "./machine";
import { heardFeedback, openPlace } from "./state";

/*
 * What the agent reads in the feedback file, as it happens: a chat's message with the step
 * or the page it is on, and the pointed notes sent in it, a step the reviewer settled or
 * opened again, or a variant kept. The agent answers the message and its pointed notes in
 * the chat, by the line's `id`. The settle that Finish sends has an `id` too: the hand-off,
 * where the agent answers the review as a whole. A note and a settle carry the variants the reviewer kept and deleted in the
 * step's parts, so the agent reads them with the reasons. A settled step is right: the
 * agent stops work on it. A take-back (notes/take-back.ts) is a chat's message as any other,
 * with `withdraws`: the message, or the finished review, that the agent must ignore.
 */

const journeyOf = <C>(journeys: readonly DevJourney<C>[], session: Context) =>
  journeys.find((j) => j.id === session.journey) ?? journeys[0];

function lineOf<C>(journey: DevJourney<C> | undefined, session: Context, n: Note) {
  // A page's chat: its place is the page.
  const path = placePath(n.step);
  if (path !== undefined)
    return {
      id: n.id,
      step: { number: 0, id: n.step, group: path, title: "This page" },
      variants: [],
      thread: n.thread,
    };
  const index = journey?.steps.findIndex((s) => s.id === n.step) ?? -1;
  const step = journey?.steps[index];
  return {
    id: n.id,
    step: { number: index + 1, id: n.step, group: step?.group.title, title: step?.title },
    variantShowing: step?.variants?.[session.variants[n.step] ?? 0]?.label,
    variants: step?.variants?.map((v) => v.label) ?? [],
    thread: n.thread,
  };
}

/** The variants the reviewer kept and deleted in the step's parts (part/variants.tsx), with
 * the command that applies them to the code, at once: a part left with variants it no longer
 * has is a choice that is not there. None when the step has no verdicts. */
function partsOf(session: Context, step: string) {
  const parts = session.feedback[step]?.parts;
  if (parts === undefined) return {};
  const decided = Object.entries(parts).filter(([, v]) => v.kept.length + v.dropped.length > 0);
  if (decided.length === 0) return {};
  return {
    parts,
    apply: `Run now, before the next line: blueline apply <feedback.jsonl> --part <part>, for ${decided.map(([name]) => JSON.stringify(name)).join(", ")}`,
  };
}

/** The step's own variant (DevStep.variants) that the settle kept. It has no `variants()` call
 * for `blueline apply` to change, so the line tells the agent to make it the app's own. */
function keptVariantOf(session: Context, step: string) {
  const variant = session.feedback[step]?.variant;
  if (variant === undefined) return {};
  return {
    variant,
    keep: `Make the step's variant "${variant}" the app's own design. It has no variants() call, so blueline apply cannot do it.`,
  };
}

export function postedLine<C>(journeys: readonly DevJourney<C>[], post: Post, sentAt: string) {
  const { session } = post;
  const journey = journeyOf(journeys, session);
  const chat = session.notes.find((n) => n.id === post.ids[0]);
  if (post.kind === "note" && chat !== undefined) {
    const last = chat.thread.at(-1);
    // A take-back names what it takes back; a finished review's names its hand-off, the chat
    // the agent answers the review in, which has no step.
    const withdraws = last?.withdraws === undefined ? {} : { withdraws: last.withdraws };
    const finished = handoffJourney(chat.step);
    if (finished !== undefined)
      return {
        kind: "note",
        journey: finished,
        sentAt,
        id: chat.id,
        thread: chat.thread,
        sentWords: true,
        pins: [],
        ...withdraws,
      };
    return {
      kind: "note",
      // The page's notes go to the page's own review, which `blueline review` listens to.
      journey: placePath(chat.step) === undefined ? session.journey : PAGE_JOURNEY,
      sentAt,
      ...lineOf(journey, session, chat),
      ...partsOf(session, chat.step),
      // A message with no words, sent for its pointed notes, says nothing of its own.
      sentWords: last !== undefined && (last.text !== "" || (last.images?.length ?? 0) > 0),
      pins: (last?.pins ?? []).map((p) => ({
        pin: p.pin,
        text: p.text,
        ...(p.images === undefined ? {} : { images: p.images }),
      })),
      ...withdraws,
    };
  }
  const id = post.step ?? "";
  const index = journey?.steps.findIndex((s) => s.id === id) ?? -1;
  const step = journey?.steps[index];
  const f = session.feedback[id];
  return {
    kind: post.kind,
    journey: session.journey,
    sentAt,
    step: { number: index + 1, id, group: step?.group.title, title: step?.title },
    settled: f?.settled === true,
    // The steps still open: none means the reviewer is through the journey. A settle that
    // waits for Finish has not gone, so its step counts as open until then.
    left: openPlace(
      journey?.steps.map((s) => s.id) ?? [],
      heardFeedback(session.feedback, session.finish),
      index,
    ).open,
    ...partsOf(session, id),
    ...keptVariantOf(session, id),
    ...handoffOf(post),
  };
}

/** The settle that Finish sends names the hand-off (notes/handoff.ts): the panel shows the
 * agent's answer on that ID, as its plan while it works and then its reply. */
function handoffOf(post: Post) {
  if (post.handoff === undefined) return {};
  return {
    id: post.handoff,
    reply: `The review is done. Answer it on this id: blueline reply <status.json> ${post.handoff} working --blocks <plan.json> while you work, then blueline reply <status.json> ${post.handoff} replied <text>.`,
  };
}
