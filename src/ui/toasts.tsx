import { useEffect, useRef, useState } from "react";
import { STORED } from "../io/stored";
import { UI } from "./geometry";
import { placePath } from "../part/page";
import { isHandoff } from "../notes/handoff";
import { openHandoff, openPlaceReply, openReply } from "./replies";
import { useTools } from "./session";

/*
 * Short messages at the top of the screen: the agent answered, an undo, the preview, or a
 * send that failed. A reply to a finished review is news too: its journey's row marks it, and
 * Open shows its hand-off. The newest stands on top, three show at most, and each goes after a
 * while. They are the tools' own, so they write no CSS into the page.
 */

/** How long a message shows. */
const SHOWN_MS = 4000;
/** How many messages show at once. */
const SHOWN = 3;

interface Toast {
  readonly id: number;
  readonly text: string;
  readonly open: (() => void) | undefined;
}
/** The preview's keys are told once: after that the reviewer knows them. */
const PREVIEW_TOLD = `${STORED}:preview-told`;

export function Toasts() {
  const { actor } = useTools();
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const next = useRef(0);
  useEffect(() => {
    const timers = new Set<number>();
    const show = (text: string, open?: () => void) => {
      const id = (next.current += 1);
      setToasts((all) => [{ id, text, open }, ...all].slice(0, SHOWN));
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        setToasts((all) => all.filter((t) => t.id !== id));
      }, SHOWN_MS);
      timers.add(timer);
    };
    const subs = [
      actor.on("replied", (e) => {
        // A hand-off that shows has its answer in view already.
        const { context } = actor.getSnapshot();
        if (isHandoff(e.note)) {
          if (context.handoff === e.note.id && !context.active && context.panel && !context.preview)
            return;
          show(`The agent answered the review: ${e.note.thread.at(-1)?.text ?? ""}`, () =>
            openHandoff(actor, e.note.id),
          );
          return;
        }
        show(
          e.settled
            ? "The agent settled an annotation, as you said"
            : `The agent answered: ${e.note.thread.at(-1)?.text ?? ""}`,
          () => {
            if (placePath(e.note.step) !== undefined) {
              openPlaceReply(actor, e.note);
              return;
            }
            const { context } = actor.getSnapshot();
            const journey =
              context.journeys.find((j) => j.id === context.journey) ?? context.journeys[0];
            const at = journey?.steps.findIndex((s) => s.id === e.note.step) ?? -1;
            if (at >= 0) openReply(actor, at);
          },
        );
      }),
      actor.on("undone", (e) => show(e.redo ? `Did again: ${e.label}` : `Undid: ${e.label}`)),
      actor.on("previewing", () => {
        if (localStorage.getItem(PREVIEW_TOLD) !== null) return;
        localStorage.setItem(PREVIEW_TOLD, "1");
        show("Preview: the eye at the bottom shows the tools again");
      }),
      actor.on("nothing", (e) => show(e.redo ? "Nothing to redo" : "Nothing to undo")),
      actor.on("unvaried", () => show("This step has no variants or states")),
      actor.on("failed", () =>
        show("The dev server did not take it. Your words are back in their field."),
      ),
    ];
    return () => {
      for (const s of subs) s.unsubscribe();
      for (const t of timers) window.clearTimeout(t);
      // Their timers are gone, so another session's messages start afresh.
      setToasts([]);
    };
  }, [actor]);
  const gone = (id: number) => setToasts((all) => all.filter((t) => t.id !== id));
  return (
    <ol
      {...UI}
      aria-live="polite"
      className="pointer-events-none fixed top-4 left-1/2 z-[999999999] flex w-[min(356px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((t) => (
        <li
          key={t.id}
          role="status"
          className="pointer-events-auto flex w-full animate-dt-arrive items-center gap-3 rounded-dt-control bg-dt-panel px-3 py-2 text-[13px] text-dt-text shadow-dt-float"
        >
          <span className="line-clamp-2 min-w-0 flex-1">{t.text}</span>
          {t.open !== undefined && (
            <button
              type="button"
              className="shrink-0 rounded-dt-mark px-1.5 py-0.5 text-[12px] text-dt-accent hover:bg-dt-raised"
              onClick={() => {
                gone(t.id);
                t.open?.();
              }}
            >
              Open
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
