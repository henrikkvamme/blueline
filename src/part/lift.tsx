import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageSquare } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from "react";
import { cx } from "../ui/cx";
import { lineShift, liftRoom } from "../ui/geometry";
import { swipeOf, swipeStarts, type Point } from "../ui/swipe";

/*
 * The lift: v takes the reviewed part off the page onto a stage, with the page dimmed
 * behind it. The part's variants stand in a row, and h and l slide through them; its states
 * stand in a column, and j and k slide through them. The row and the column cross at the
 * part, so a move from one to the other leaves the part where it is; the one not in use
 * stays faint. Enter puts the one shown on the page, and Escape or v puts the part back as
 * it was; either way the part goes down to where the page now shows it. Settling the step
 * keeps the variant the page shows.
 * d deletes a variant the reviewer does not want, once they confirm it, and u or Cmd+Z
 * brings it back.
 * On a phone, a swipe across the stage goes over the variants, and a swipe up or down over
 * the states; the bar's buttons do what each key does.
 *
 * It works the same for a button, a card, a form section and the whole page: each option is
 * the part itself, scaled down to fit; a small part keeps its true size. z zooms in. A part that fills its column, as a card, draws each
 * option at the column's width; a part that takes its content's size, as a button, draws
 * each option at its own size.
 */

/** A variant of the part, by its label, in a state, by its place in the column. */
export interface At {
  readonly variant: string;
  readonly state: number;
}

/** Which way the stage runs: variants in a row, or states in a column. */
export type Axis = "variant" | "state";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MS = 320;
const GAP = 40;
/** In the column, the gap also holds the name under each option. */
const COLUMN_GAP = 80;

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function Lift({
  title,
  variants,
  states,
  render,
  start,
  from,
  hug,
  onDrop,
  onUndo,
  onNote,
  note,
  noted,
  onPut,
  where,
  onDone,
  docked = 0,
}: {
  /** What the part is, as "the Submit button". */
  readonly title: string;
  /** The variants' labels, without the ones the reviewer deleted. */
  readonly variants: readonly string[];
  /** The states' names; the first is the part as the page gives it. */
  readonly states: readonly string[];
  readonly render: (at: At) => ReactNode;
  /** What the page shows now. */
  readonly start: At;
  /** Where the part is on the page. */
  readonly from: DOMRect;
  /** Whether the part takes its content's size, so each option has a size of its own. */
  readonly hug: boolean;
  readonly onDrop: (variant: string) => void;
  /** Takes back the reviewer's last delete. */
  readonly onUndo: () => void;
  /** Opens the note on the variant and state shown; none where the lift takes no notes. */
  readonly onNote: ((at: At) => void) | undefined;
  /** The open note, to write in. */
  readonly note: ReactNode;
  /** The variants with a note. */
  readonly noted: readonly string[];
  /** Shows a variant and state on the page, under the stage: the one chosen, or the start. */
  readonly onPut: (at: At) => void;
  /** Where the part is on the page now. */
  readonly where: () => DOMRect | undefined;
  /** The part is down on the page, and the lift ends. */
  readonly onDone: () => void;
  /** How wide the tools' panel is, docked at the window's right; none when it is not. */
  readonly docked?: number | undefined;
}) {
  const [at, setAt] = useState(start);
  // Where the variant shown stands in the row: a deleted one's place, until another shows.
  const place = useRef(0);
  const found = variants.indexOf(at.variant);
  if (found >= 0) place.current = found;
  const index = Math.min(place.current, variants.length - 1);
  // The variant the reviewer asked to delete, while they confirm it.
  const [asking, setAsking] = useState<string>();
  const [axis, setAxis] = useState<Axis>("variant");
  // True for the frame in which the way changes: the part then passes from the row to the
  // column, or back, at once, as both draw it in the same place.
  const [turning, setTurning] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // The stage stands in the page's room beside the docked panel, so no variant goes under it.
  const room = liftRoom(vw, docked);
  // A big part shrinks to fit the stage; a small one keeps its true size. z zooms: a shrunk
  // part to its true size, a part at its true size to twice that.
  const [zoomed, setZoomed] = useState(false);
  const fit = Math.min(1, (room * 0.56) / from.width, (vh * 0.62) / from.height);
  const scale = zoomed ? (fit < 1 ? 1 : 2) : fit;
  // A zoom draws the stage at the new scale at once, then grows it there from the old one
  // around the part, so nothing jumps; the lines do not slide meanwhile.
  const stage = useRef<HTMLDivElement>(null);
  const [zooming, setZooming] = useState(false);
  const was = useRef(scale);
  useLayoutEffect(() => {
    const el = stage.current;
    if (was.current === scale || el === null) return;
    el.animate([{ transform: `scale(${String(was.current / scale)})` }, { transform: "none" }], {
      duration: MS,
      easing: EASE,
    });
    was.current = scale;
  }, [scale]);
  useEffect(() => {
    if (!zooming) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setZooming(false));
    });
    return () => cancelAnimationFrame(frame);
  }, [zooming]);
  const focused = useRef<HTMLDivElement>(null);
  const row = axis === "variant";

  // The size each option takes, measured, as options differ in size. Both lines stay drawn,
  // so their sizes are known before either shows.
  const rowEls = useRef<(HTMLElement | null)[]>([]);
  const colEls = useRef<(HTMLElement | null)[]>([]);
  const [widths, setWidths] = useState<readonly number[]>([]);
  const [heights, setHeights] = useState<readonly number[]>([]);
  useLayoutEffect(() => {
    rowEls.current.length = variants.length;
    const w = variants.map((_, i) => rowEls.current[i]?.offsetWidth ?? 0);
    const h = states.map((_, i) => colEls.current[i]?.offsetHeight ?? 0);
    if (!same(w, widths)) setWidths(w);
    if (!same(h, heights)) setHeights(h);
  });
  const measured = widths.length === variants.length && heights.length === states.length;

  useEffect(() => {
    if (!turning) return;
    const frame = requestAnimationFrame(() => setTurning(false));
    return () => cancelAnimationFrame(frame);
  }, [turning]);
  const turn = (to: Axis) => {
    if (to === axis) return;
    setAxis(to);
    setTurning(true);
  };

  // Moves the part on the stage, at `to`, onto its place on the page.
  const onto = (place: DOMRect, to: DOMRect) =>
    `translate(${String(place.left - to.left)}px, ${String(place.top - to.top)}px) scale(${String(place.width / to.width)})`;

  // The part rises from its place on the page to the stage, once it is measured.
  const rose = useRef(false);
  useLayoutEffect(() => {
    const el = focused.current;
    if (rose.current || el === null || !measured) return;
    rose.current = true;
    el.animate(
      [
        { transformOrigin: "top left", transform: onto(from, el.getBoundingClientRect()) },
        { transformOrigin: "top left", transform: "none" },
      ],
      { duration: MS, easing: EASE },
    );
  });

  // The part goes down to its place on the page: as chosen, or, put back, as it was. The
  // page shows it first, under the stage, so the part lands where that option stands, which
  // differs when the option differs in size.
  const [down, setDown] = useState<At>();
  const finish = (chosen: At | undefined) => {
    if (leaving) return;
    setLeaving(true);
    // Put back, the stage first shows the part as the page has it, at once, then lowers it.
    if (chosen === undefined) setAt(start);
    onPut(chosen ?? start);
    setDown(chosen ?? start);
  };
  useEffect(() => {
    if (down === undefined) return;
    // A frame later, so the stage and the page have drawn the option.
    const frame = requestAnimationFrame(() => {
      const el = focused.current;
      const place = where() ?? from;
      if (el === null) {
        onDone();
        return;
      }
      el.animate(
        [
          { transformOrigin: "top left", transform: "none" },
          { transformOrigin: "top left", transform: onto(place, el.getBoundingClientRect()) },
        ],
        { duration: MS - 60, easing: EASE, fill: "forwards" },
      ).onfinish = onDone;
    });
    return () => cancelAnimationFrame(frame);
  }, [down]);

  const go = (to: Axis, i: number) =>
    setAt((a) =>
      to === "variant" ? { ...a, variant: variants[i] ?? a.variant } : { ...a, state: i },
    );
  // A move on the other way first turns to it, and moves once the turn is drawn.
  const pick = (to: Axis, i: number) => {
    if (to === axis) go(to, i);
    else {
      turn(to);
      window.setTimeout(() => go(to, i), 40);
    }
  };

  const move = (to: Axis, by: number) => {
    const n = to === "variant" ? variants.length : states.length;
    const i = to === "variant" ? index : at.state;
    if (n > 1) pick(to, Math.min(Math.max(i + by, 0), n - 1));
  };
  // The last variant stays: a part shows one.
  const ask = () => {
    if (variants.length > 1) setAsking(at.variant);
  };
  const hasNotes = noted.some((label) => variants.includes(label));
  // The next variant with a note, after this one, round to the first.
  const nextNote = () => {
    const after = variants.map((_, i) => (index + 1 + i) % variants.length);
    const next = after.find((i) => noted.includes(variants[i] ?? ""));
    if (next !== undefined) pick("variant", next);
  };
  const zoom = () => {
    setZooming(true);
    setZoomed((z) => !z);
  };

  // A swipe on the stage: across for the variants, up or down for the states.
  const touch = useRef<Point>(undefined);
  const swipe = {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      const p = t === undefined ? undefined : { x: t.clientX, y: t.clientY };
      touch.current =
        e.touches.length === 1 && p !== undefined && swipeStarts(p, vw) ? p : undefined;
    },
    onTouchEnd: (e: TouchEvent) => {
      const from = touch.current;
      const t = e.changedTouches[0];
      touch.current = undefined;
      if (from === undefined || t === undefined || asking !== undefined || leaving) return;
      const to = { x: t.clientX, y: t.clientY };
      const across = swipeOf(from, to, "x");
      const upDown = states.length > 1 ? swipeOf(from, to, "y") : undefined;
      if (across !== undefined) move("variant", across);
      else if (upDown !== undefined) move("state", upDown);
    },
    onTouchCancel: () => {
      touch.current = undefined;
    },
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A note's field keeps its keys; Escape there closes the note, not the lift.
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName)))
        return;
      if (e.metaKey || e.ctrlKey) {
        // Cmd+Z and Ctrl+Z take back a delete, as u does.
        if (e.key !== "z" || e.altKey || e.shiftKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (asking === undefined) onUndo();
        return;
      }
      if (asking !== undefined) {
        const answer: Record<string, () => void> = {
          Enter: () => drop(asking),
          y: () => drop(asking),
          Escape: () => setAsking(undefined),
          n: () => setAsking(undefined),
          d: () => setAsking(undefined),
        };
        // While the reviewer confirms, the lift takes no other key.
        if (e.altKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        answer[e.key]?.();
        return;
      }
      const keys: Record<string, () => void> = {
        h: () => move("variant", -1),
        ArrowLeft: () => move("variant", -1),
        l: () => move("variant", 1),
        ArrowRight: () => move("variant", 1),
        k: () => move("state", -1),
        ArrowUp: () => move("state", -1),
        j: () => move("state", 1),
        ArrowDown: () => move("state", 1),
        // v, which opened the lift, closes it.
        v: () => finish(undefined),
        Enter: () => finish(at),
        Escape: () => finish(undefined),
        d: ask,
        u: onUndo,
        // As on the page: i writes a note, R goes to what has one.
        i: () => onNote?.(at),
        R: nextNote,
        z: zoom,
      };
      if (e.altKey) return;
      // The lift takes every key while it is up, so the walk's keys wait under it.
      e.preventDefault();
      e.stopImmediatePropagation();
      keys[e.key]?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const onPage = (o: At) => o.variant === start.variant && o.state === start.state;

  // The part shows its neighbour, then the deleted variant leaves the row.
  const drop = (label: string) => {
    setAsking(undefined);
    const i = variants.indexOf(label);
    const next = variants[i + 1] ?? variants[i - 1];
    if (next === undefined) return;
    setAt((a) => ({ ...a, variant: next }));
    onDrop(label);
  };

  /** One option on one way's line. */
  const option = (way: Axis, i: number) => {
    const label = variants[i] ?? "";
    const o: At = way === "variant" ? { ...at, variant: label } : { ...at, state: i };
    const middle = i === (way === "variant" ? index : at.state);
    const used = way === axis;
    // The part in the middle shows on the way in use; on the other way it waits unseen.
    const opacity = leaving && !middle ? 0 : middle ? (used ? 1 : 0) : used ? 0.45 : 0.22;
    const name = way === "variant" ? label : states[i];
    return (
      <div
        key={way === "variant" ? label : i}
        ref={(el) => {
          (way === "variant" ? rowEls : colEls).current[i] = el;
        }}
        className="relative shrink-0"
        style={{
          opacity,
          pointerEvents: opacity === 0 ? "none" : "auto",
          filter: middle ? "none" : "grayscale(0.6)",
          transform: middle ? "none" : "scale(0.82)",
          transition:
            (turning || down !== undefined) && middle
              ? "none"
              : `opacity ${String(MS)}ms ${EASE}, transform ${String(MS)}ms ${EASE}, filter ${String(MS)}ms ${EASE}`,
        }}
      >
        {/* The card zooms with the part, so its corners and shadow keep their true look.
            The lift moves the outer box, as a zoom would also scale its moves. */}
        <div ref={middle && used ? focused : undefined}>
          <div
            className="relative text-left text-[#16161a]"
            style={{ width: hug ? "max-content" : from.width, zoom: scale }}
            // A copy on the stage is to look at: its buttons and fields do nothing.
            inert
          >
            {/* The card stands out round the part, so a part with no frame of its own, as
                a field, does not touch its edge; the part keeps its size and place. */}
            <div
              aria-hidden
              className="absolute -inset-3 rounded-[14px] bg-white shadow-[0_24px_60px_-18px_rgb(0_0_0/0.6)]"
            />
            <div className="relative">{render(o)}</div>
          </div>
        </div>
        {/* The name stands under the option, out of the line's spacing, so options of
            any size stand evenly apart; the faint way shows no names. */}
        <div
          className={cx(
            "absolute top-full left-1/2 mt-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-dt-panel px-2.5 py-1 text-[12px] whitespace-nowrap shadow-dt-float",
            middle ? "text-dt-text" : "text-dt-muted",
            !used && "invisible",
          )}
        >
          {!middle && <span className="text-dt-faint tabular-nums">{i + 1}</span>}
          <span className="font-medium">{name}</span>
          {way === "variant" && noted.includes(label) && (
            <MessageSquare className="size-3 text-dt-muted" aria-label="With a note" />
          )}
          {onPage(o) && <span className="text-dt-faint">· on the page</span>}
        </div>
        {/* The click target lies over the copy and not round it, as the copy's own buttons
            cannot stand in a button. */}
        <button
          type="button"
          aria-label={middle ? `Use ${name ?? ""}` : `Show ${name ?? ""}`}
          tabIndex={opacity === 0 ? -1 : undefined}
          onClick={() => (middle ? finish(o) : pick(way, i))}
          className="absolute -inset-3 rounded-[14px] outline-none"
        />
      </div>
    );
  };

  return (
    <div
      className={cx("blueline fixed inset-0 z-[2147483005]", leaving && "pointer-events-none")}
      role="dialog"
      aria-label={`Variants and states of ${title}`}
    >
      <div
        className={cx(
          "absolute inset-0 animate-in touch-none transition-opacity duration-200 fade-in",
          "bg-black/55",
          leaving && "opacity-0",
        )}
        onClick={() => {
          if (asking === undefined) finish(undefined);
        }}
        {...swipe}
      />
      {/* The room beside the docked panel: the stage, its bar, the note and the question
          stand in its middle. The dim covers the panel too. */}
      <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: room }}>
        {/* Before the sizes are measured, the stage waits unseen, so it does not jump. */}
        <div
          ref={stage}
          className="pointer-events-none absolute inset-0 touch-none"
          style={{ opacity: measured ? 1 : 0 }}
          {...swipe}
        >
          <div className={cx("absolute inset-x-0 top-1/2 -translate-y-1/2", row && "z-10")}>
            <div
              className="flex items-center"
              style={{
                gap: GAP,
                transform: `translateX(${String(lineShift(widths, index, room, GAP))}px)`,
                transition:
                  down === undefined && !zooming ? `transform ${String(MS)}ms ${EASE}` : "none",
              }}
            >
              {variants.map((_, i) => option("variant", i))}
            </div>
          </div>
          <div className={cx("absolute inset-y-0 left-1/2 -translate-x-1/2", !row && "z-10")}>
            <div
              className="flex flex-col items-center"
              style={{
                gap: COLUMN_GAP,
                transform: `translateY(${String(lineShift(heights, at.state, vh, COLUMN_GAP))}px)`,
                transition:
                  down === undefined && !zooming ? `transform ${String(MS)}ms ${EASE}` : "none",
              }}
            >
              {states.map((_, i) => option("state", i))}
            </div>
          </div>
        </div>
        <div
          className={cx(
            "pointer-events-auto absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 animate-in items-center gap-1 rounded-full bg-dt-panel px-2 py-1.5 text-[12px] whitespace-nowrap text-dt-muted shadow-dt-float duration-200 fade-in slide-in-from-bottom-2",
            "max-sm:inset-x-2 max-sm:bottom-[calc(env(safe-area-inset-bottom)+8px)] max-sm:translate-x-0 max-sm:flex-wrap max-sm:justify-center max-sm:rounded-dt-panel max-sm:text-[14px]",
            leaving && "opacity-0",
          )}
        >
          <span className="px-2 font-medium text-dt-text first-letter:uppercase max-sm:w-full max-sm:truncate max-sm:py-1 max-sm:text-center">
            {title}
          </span>
          <Way
            on={row}
            name="Variant"
            value={at.variant}
            place={`${String(index + 1)} of ${String(variants.length)}`}
            across
            onMove={(by) => move("variant", by)}
          />
          {states.length > 1 && (
            <Way
              on={!row}
              name="State"
              value={states[at.state]}
              place={`${String(at.state + 1)} of ${String(states.length)}`}
              across={false}
              onMove={(by) => move("state", by)}
            />
          )}
          {variants.length > 1 && <Act onClick={ask}>Delete</Act>}
          {onNote !== undefined && <Act onClick={() => onNote(at)}>Note</Act>}
          {hasNotes && <Act onClick={nextNote}>Next note</Act>}
          <Act onClick={onUndo}>Undo</Act>
          <Act onClick={zoom} on={zoomed}>
            {zoomed ? "True size" : "Zoom"}
          </Act>
          <Act onClick={() => finish(at)}>Use</Act>
          <Act onClick={() => finish(undefined)}>Put back</Act>
        </div>
        {note !== undefined && note !== null && (
          <div className="pointer-events-auto absolute bottom-20 left-1/2 z-30 -translate-x-1/2 max-sm:top-[calc(env(safe-area-inset-top)+8px)] max-sm:bottom-auto">
            {note}
          </div>
        )}
        {asking !== undefined && (
          <Confirm
            label={asking}
            onDelete={() => drop(asking)}
            onCancel={() => setAsking(undefined)}
          />
        )}
      </div>
    </div>
  );
}

/** Asks the reviewer to confirm that a variant goes. */
function Confirm({
  label,
  onDelete,
  onCancel,
}: {
  readonly label: string;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center">
      <div
        role="alertdialog"
        aria-label={`Delete ${label}`}
        className="flex w-[340px] max-w-[calc(100vw-16px)] animate-in flex-col gap-3 rounded-dt-panel bg-dt-panel p-4 text-[13px] text-dt-muted shadow-dt-float duration-150 fade-in zoom-in-95"
      >
        <span className="text-[14px] font-medium text-dt-text">Delete “{label}”?</span>
        <p className="leading-[1.45]">The agent takes it out of the code. Undo brings it back.</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-dt-control px-2.5 py-1.5 text-dt-text hover:bg-dt-raised max-sm:min-h-11 max-sm:px-4"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-dt-control bg-dt-bad/15 px-2.5 py-1.5 text-dt-bad hover:bg-dt-bad/25 max-sm:min-h-11 max-sm:px-4"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/** One way the stage runs, in the bar: what is shown, with a step back and forward. */
function Way({
  on,
  name,
  value,
  place,
  across,
  onMove,
}: {
  readonly on: boolean;
  readonly name: string;
  readonly value: string | undefined;
  readonly place: string;
  /** Whether the way runs across, as the variants, or up and down, as the states. */
  readonly across: boolean;
  readonly onMove: (by: 1 | -1) => void;
}) {
  const Back = across ? ChevronLeft : ChevronUp;
  const Forward = across ? ChevronRight : ChevronDown;
  const step =
    "grid size-5 shrink-0 place-items-center rounded-full hover:bg-white/10 max-sm:size-11";
  const lower = name.toLowerCase();
  return (
    <span
      className={cx(
        "flex items-center gap-1.5 rounded-full px-1 py-0.5 max-sm:min-w-0",
        on ? "bg-white/10 text-dt-text" : "text-dt-muted",
      )}
    >
      <button
        type="button"
        aria-label={`Previous ${lower}`}
        onClick={() => onMove(-1)}
        className={step}
      >
        <Back className="size-3.5" />
      </button>
      <span className="text-dt-faint">{name}</span>
      <span className="max-sm:truncate">{value}</span>
      <span className="text-dt-faint tabular-nums">{place}</span>
      <button type="button" aria-label={`Next ${lower}`} onClick={() => onMove(1)} className={step}>
        <Forward className="size-3.5" />
      </button>
    </span>
  );
}

/** One thing the reviewer can do in the lift, in its bar. */
function Act({
  onClick,
  on,
  children,
}: {
  readonly onClick: () => void;
  /** Whether it is on, as the zoom. */
  readonly on?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "rounded-full px-2 py-0.5 hover:bg-dt-raised hover:text-dt-text max-sm:min-h-11 max-sm:px-3",
        on === true && "text-dt-text",
      )}
    >
      {children}
    </button>
  );
}
