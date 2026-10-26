import { Trash2 } from "lucide-react";
import { zoneOf } from "../keys/keymap";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isKept, type Note } from "../notes/note";
import { joinsDraft } from "../notes/pins";
import { SHEET } from "./panel";
import { Composer } from "./composer";
import { cx } from "./cx";
import { DOCK, FOCUSED, UI } from "./geometry";
import { DragHandle, useCard, useElementBox } from "./overlays";
import { sendPins, useSession, useTools } from "./session";
import { usePhone } from "./touch";
import { focusToWrite } from "../vim";

/*
 * A note on an element the reviewer pointed at, in a card beside the element. Enter sends it
 * at once, as a message with its pin, in the chat of its step or page, where the agent answers
 * it; the focus goes back to the page. Later, or Cmd+Enter, keeps it on its pin: it waits, its
 * chip stands over the message field, and it goes with the next message. While the chat's
 * message field holds words, the note joins them instead: Enter keeps it too. The card's
 * button shows which: send, or a check.
 */

const WIDTH = 320;

export function NoteCard({ note, number }: { readonly note: Note; readonly number: number }) {
  const { actor } = useTools();
  const joins = useSession((s) => joinsDraft(s.context.notes, note.step));
  const box = useElementBox(note.pin?.selector);
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState(120);
  useLayoutEffect(() => {
    const h = card.current?.offsetHeight;
    if (h !== undefined && Math.abs(h - height) > 1) setHeight(h);
  });
  const shown = box !== undefined;
  useEffect(() => {
    // A new note opens to write in; one with words opens in normal mode, as nvim does. One
    // opened from the tree leaves the keys there, as its other rows do; i goes in.
    if (!shown) return;
    const fresh = note.draft === "";
    if (!fresh && zoneOf(document.activeElement) === "panel") return;
    if (note.draft === "") focusToWrite(field.current);
    else field.current?.focus();
  }, [note.id, shown]);
  const ring =
    box === undefined
      ? undefined
      : { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 };
  const drag = useCard(note.id, ring, { width: WIDTH, height }, "below");
  const place = drag.place;
  const phone = usePhone();
  if (ring === undefined || place === undefined) return null;
  return (
    <>
      <div
        {...UI}
        aria-hidden
        className="pointer-events-none fixed z-[2147483002] rounded-dt-mark ring-2 ring-dt-warn"
        style={{
          left: ring.x + 1,
          top: ring.y + 1,
          width: ring.width - 2,
          height: ring.height - 2,
        }}
      />
      <div
        {...DOCK}
        ref={card}
        role="dialog"
        aria-label={`Annotation ${number}`}
        data-dt-zone="list"
        // The fade's duration with no transition named would ease every change, a drag too.
        className={cx(
          "group/card fixed z-[2147483003] flex animate-in flex-col gap-2 rounded-dt-panel bg-dt-panel p-3 text-dt-text shadow-dt-float transition-none duration-150 fade-in zoom-in-95",
          FOCUSED,
          SHEET,
          drag.dragging && "select-none",
        )}
        style={phone ? undefined : { width: WIDTH, left: place.left, top: place.top }}
      >
        {!phone && <DragHandle onPointerDown={drag.onPointerDown} />}
        <div className="flex items-center gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-dt-warn text-[10px] leading-none font-semibold text-dt-ground tabular-nums">
            {number}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-dt-muted max-sm:text-[14px]">
            {note.pin?.what}
          </span>
          <button
            type="button"
            aria-label="Remove the annotation"
            onClick={() => actor.send({ type: "remove", id: note.id })}
            className="grid size-6 place-items-center rounded-dt-mark text-dt-faint hover:bg-dt-raised hover:text-dt-text max-sm:size-11"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
        <Composer
          id={note.id}
          step={note.step}
          pin={note.pin}
          note={note}
          sends={false}
          sendsNote={!joins}
          fieldRef={field}
          placeholder="What should change here?"
          onDone={(how) => {
            actor.send({ type: "close" });
            // Later, or Cmd+Enter, keeps it on its pin: it goes with the next message.
            if (how === "enter" && !joins && isKept(note)) sendPins(actor, note.step, note.id);
          }}
        />
      </div>
    </>
  );
}
