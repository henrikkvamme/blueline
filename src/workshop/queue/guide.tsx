import { CircleAlert, MousePointerClick, Pause } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "../../ui/cx";
import { PANEL } from "../../ui/geometry";
import { aim, type Box, type Mark, NOTE, type Note, type Walker } from "./walker";

/*
 * What the agent's cursor shows on the page, from its walker: the cursor's canvas, the mark
 * it draws on the element, and its note beside it. The voice says the line; the page shows a
 * mark and a few words, as Clicky does. The note looks like an annotation, in the agent's
 * colour. Its buttons are the guide's own (`data-guide-ui`), so a press on them does not
 * pause the walk.
 */

/** Blueline's accent, for the cursor's body and glow, and for what the agent draws. */
const FILL = "#4a6cf7";

/** How long a mark or a note takes to go. */
const GOING = 200;

export function Guide({ walker, reduced }: { readonly walker: Walker; readonly reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const snap = useSyncExternalStore(walker.subscribe, walker.snapshot);
  useEffect(
    () => (canvas.current === null ? undefined : walker.attach(canvas.current, FILL)),
    [walker],
  );
  const marks = useGoing(snap.mark, reduced ? 0 : GOING);
  const notes = useGoing(snap.note, reduced ? 0 : GOING);
  return (
    <>
      {marks.map(({ value, going }) => (
        <MarkView key={value.key} mark={value} going={going} reduced={reduced} />
      ))}
      {notes.map(({ value, going }) => (
        <NoteView key={value.key} note={value} going={going} walker={walker} reduced={reduced} />
      ))}
      <canvas
        ref={canvas}
        aria-hidden
        className={cx(
          "pointer-events-none fixed inset-y-0 left-0 z-[2147483002] h-full",
          !reduced && "transition-opacity duration-200",
          snap.shown ? "opacity-100" : "opacity-0",
        )}
        style={{ width: `calc(100% - ${String(PANEL)}px)` }}
      />
    </>
  );
}

/**
 * The value that shows, and the ones that go: a value with a new key replaces the old one,
 * which fades out for `ms` before it leaves, so what comes in also goes out.
 */
function useGoing<T extends { readonly key: string }>(value: T | undefined, ms: number) {
  const [going, setGoing] = useState<readonly T[]>([]);
  const held = useRef<T | undefined>(undefined);
  useEffect(() => {
    const was = held.current;
    held.current = value;
    if (was === undefined || was.key === value?.key || ms === 0) return;
    setGoing((g) => [...g, was]);
    window.setTimeout(() => setGoing((g) => g.filter((x) => x !== was)), ms);
  }, [value, ms]);
  return [
    ...going.filter((g) => g.key !== value?.key).map((g) => ({ value: g, going: true })),
    ...(value === undefined ? [] : [{ value, going: false }]),
  ];
}

const GONE = { animation: `dt-fade ${String(GOING)}ms ease-in reverse both` } as const;

/**
 * A loop drawn by hand round the box: a rounded square (a superellipse), so a wide element
 * sits inside it to its corners. It starts where the cursor points, wobbles a little, and
 * runs on past its start, as a pen does.
 */
function loop(box: Box, from: { readonly x: number; readonly y: number }) {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const rx = box.width / 2 + 12;
  const ry = box.height / 2 + 9;
  const start = Math.atan2(from.y - cy, from.x - cx);
  const turn = Math.PI * 2 * 1.1;
  const curve = (v: number) => Math.sign(v) * Math.abs(v) ** (1 / 3);
  const points = Array.from({ length: 97 }, (_, i) => {
    const t = (i / 96) * turn;
    // The pen ends a little wide of where it began, and its hand is not quite steady.
    const r = 1 + 0.04 * (t / turn) + 0.012 * Math.sin(t * 3 + 1);
    const a = start - t;
    const x = cx + curve(Math.cos(a)) * rx * r;
    const y = cy + curve(Math.sin(a)) * ry * r;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

/** A line drawn by hand under the box, a little curved, left to right. */
function underline(box: Box) {
  const y = box.top + box.height + 5;
  const left = box.left - 3;
  const right = box.left + box.width + 5;
  return `M ${String(left)} ${String(y + 1)} Q ${String((left + right) / 2)} ${String(y + 5)} ${String(right)} ${String(y - 2)}`;
}

/**
 * What the cursor draws on the element. A loop or a line draws in from the pen's start; the
 * frame of a turn draws in, then breathes until the reviewer clicks.
 */
function MarkView({
  mark,
  going,
  reduced,
}: {
  readonly mark: Mark;
  readonly going: boolean;
  readonly reduced: boolean;
}) {
  const { box } = mark;
  const draw = reduced ? undefined : "dt-draw 560ms cubic-bezier(.45,0,.2,1) both";
  const stroke = {
    fill: "none",
    stroke: FILL,
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    pathLength: 1,
    strokeDasharray: 1,
    style: { animation: draw },
  } as const;
  return (
    <svg
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[2147483000] size-full overflow-visible drop-shadow-[0_0_6px_rgb(74_108_247/0.55)]"
      style={going ? GONE : undefined}
    >
      {mark.draw === "circle" && (
        <path
          d={loop(box, aim(box, { width: innerWidth - PANEL, height: innerHeight }).tip)}
          {...stroke}
        />
      )}
      {mark.draw === "underline" && <path d={underline(box)} {...stroke} />}
      {mark.draw === "frame" && (
        <g className={cx(!reduced && "animate-pulse")}>
          <rect
            x={box.left - 5}
            y={box.top - 5}
            width={box.width + 10}
            height={box.height + 10}
            rx={10}
            fillOpacity={0.08}
            {...stroke}
            fill={FILL}
          />
        </g>
      )}
    </svg>
  );
}

const ICON = { say: undefined, turn: MousePointerClick, paused: Pause, lost: CircleAlert } as const;

/**
 * The agent's note beside the element: an annotation card in the agent's colour, with the
 * beat's number and a few words. With no voice, the whole line is under them. A turn, a
 * pause and a lost element have their buttons.
 */
function NoteView({
  note,
  going,
  walker,
  reduced,
}: {
  readonly note: Note;
  readonly going: boolean;
  readonly walker: Walker;
  readonly reduced: boolean;
}) {
  const Icon = ICON[note.tone];
  const quiet = note.tone === "paused";
  const action =
    "rounded-dt-control px-2 py-0.5 text-[12px] font-medium text-dt-muted hover:bg-dt-raised hover:text-dt-text";
  return (
    <div
      data-guide-ui=""
      role="status"
      className={cx(
        "blueline fixed z-[2147483001] flex w-max origin-top-left flex-col gap-1.5 rounded-dt-panel bg-dt-panel p-2.5 text-dt-text shadow-dt-float",
        !reduced && !going && "animate-[dt-note_300ms_cubic-bezier(.3,1.5,.5,1)_both]",
        (note.tone === "say" || going) && "pointer-events-none",
      )}
      style={{ ...note.place, maxWidth: NOTE.width, ...(going ? GONE : undefined) }}
    >
      <div className="flex items-start gap-2">
        <span
          className={cx(
            "mt-px grid size-5 shrink-0 place-items-center rounded-full text-[10px] leading-none font-semibold tabular-nums",
            note.tone === "lost"
              ? "bg-dt-warn text-dt-ground"
              : quiet
                ? "bg-dt-raised text-dt-muted"
                : "bg-dt-accent text-white",
          )}
        >
          {Icon === undefined ? note.step : <Icon className="size-3" aria-hidden />}
        </span>
        <span
          className={cx("min-w-0 text-[13px] leading-[1.35] font-medium", quiet && "text-dt-muted")}
        >
          {note.words}
        </span>
      </div>
      {note.line !== undefined && (
        <p className="pl-7 text-[12px] leading-[1.4] text-dt-muted">{note.line}</p>
      )}
      {note.tone !== "say" && (
        <div className="-mb-1 flex justify-end gap-1">
          {note.tone === "turn" && (
            <button type="button" className={action} onClick={() => walker.skip()}>
              Skip
            </button>
          )}
          {(note.tone === "paused" || note.tone === "lost") && (
            <>
              <button type="button" className={action} onClick={() => walker.stop()}>
                Stop
              </button>
              <button
                type="button"
                className="rounded-dt-control bg-dt-accent px-2 py-0.5 text-[12px] font-semibold text-white hover:brightness-110"
                onClick={() => walker.resume()}
              >
                {note.tone === "lost" ? "Try again" : "Go on"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A setting of the guide in the workshop's bar. */
export function GuideToggle({
  label,
  on,
  onChange,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        "rounded-full px-2.5 py-1",
        on ? "bg-dt-raised text-dt-text" : "text-dt-muted hover:text-dt-text",
      )}
    >
      {label}
    </button>
  );
}
