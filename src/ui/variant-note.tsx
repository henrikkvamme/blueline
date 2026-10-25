import { Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Composer } from "./composer";
import { sendPins, ToolsContext, useSession, useTools, type Tools } from "./session";
import { isKept } from "../notes/note";
import { focusToWrite } from "../vim";

/*
 * A note on a variant, in the lift (part/variants.tsx): the reviewer writes it with i on the
 * variant shown. It is a pointed note whose pin names the variant, so the step's note takes
 * it to the agent, as it takes a note on an element. The lift shows it in the app's tree, out
 * of the dev tools', so it brings their context with it.
 */

export function VariantNote({ tools }: { readonly tools: Tools }) {
  return (
    <ToolsContext.Provider value={tools}>
      <Opened />
    </ToolsContext.Provider>
  );
}

function Opened() {
  const { actor } = useTools();
  const note = useSession((s) => s.context.notes.find((n) => n.id === s.context.opened));
  const field = useRef<HTMLTextAreaElement>(null);
  const id = note?.pin?.variant === undefined ? undefined : note.id;
  useEffect(() => {
    // A new note opens to write in; one with words opens in normal mode, as nvim does.
    if (id === undefined) return;
    if (note?.draft === "") focusToWrite(field.current);
    else field.current?.focus();
  }, [id]);
  if (note === undefined || id === undefined) return null;
  return (
    <div
      role="dialog"
      aria-label="Note on the variant"
      data-dt-zone="list"
      className="flex w-[360px] max-w-[calc(100vw-16px)] animate-in flex-col gap-2 rounded-dt-panel bg-dt-panel p-3 text-dt-text shadow-dt-float duration-150 fade-in zoom-in-95"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-dt-muted">{note.pin?.what}</span>
        <button
          type="button"
          aria-label="Remove the note"
          onClick={() => actor.send({ type: "remove", id })}
          className="grid size-6 place-items-center rounded-dt-mark text-dt-faint hover:bg-dt-raised hover:text-dt-text max-sm:size-11"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
      <Composer
        id={id}
        step={note.step}
        pin={note.pin}
        note={note}
        sends={false}
        fieldRef={field}
        placeholder="What do you think of this variant?"
        escapeTo="page"
        onDone={(how) => {
          actor.send({ type: "close" });
          if (how === "enter" && isKept(note)) sendPins(actor, note.step);
        }}
      />
    </div>
  );
}
