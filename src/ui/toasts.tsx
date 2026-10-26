import { useEffect } from "react";
import { toast, Toaster } from "sonner";
import { STORED } from "../io/stored";
import { UI } from "./geometry";
import { placePath } from "../part/page";
import { isHandoff } from "../notes/handoff";
import { openHandoff, openPlaceReply, openReply } from "./replies";
import { useTools } from "./session";

/*
 * Short messages at the top of the screen: the agent answered, an undo, the preview, or a
 * send that failed. A finished journey has none: the panel shows its hand-off. Sonner stacks them and lets each go. The dev tools have their own
 * toaster, by its ID, so the app's toasts and theirs stay apart.
 */

const ID = "blueline";
/** The preview's keys are told once: after that the reviewer knows them. */
const PREVIEW_TOLD = `${STORED}:preview-told`;

export function Toasts() {
  const { actor } = useTools();
  useEffect(() => {
    const show = (text: string, open?: () => void) =>
      toast(text, {
        toasterId: ID,
        ...(open === undefined ? {} : { action: { label: "Open", onClick: open } }),
      });
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
            ? "The agent settled a note, as you said"
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
    };
  }, [actor]);
  return (
    <div {...UI}>
      <Toaster
        id={ID}
        position="top-center"
        duration={4000}
        visibleToasts={3}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              "flex w-full items-center gap-3 rounded-dt-control bg-dt-panel px-3 py-2 text-[13px] text-dt-text shadow-dt-float",
            title: "line-clamp-2",
            content: "min-w-0 flex-1",
            actionButton:
              "shrink-0 rounded-dt-mark px-1.5 py-0.5 text-[12px] text-dt-accent hover:bg-dt-raised",
          },
        }}
      />
    </div>
  );
}
