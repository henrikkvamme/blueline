import { CircleAlert, MousePointerClick, Pause } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "../../ui/cx";
import { PANEL } from "../../ui/geometry";
import { AgentMark } from "./mark";
import type { Shape } from "../../queue/queue";
import { aim, type Box, type Mark, type Mock, NOTE, type Note, type Walker } from "./walker";

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
  const mocks = useGoing(snap.mock, reduced ? 0 : GOING);
  return (
    <>
      {mocks.map(({ value, going }) => (
        <MockView key={value.key} mock={value} going={going} reduced={reduced} />
      ))}
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
          "pointer-events-none fixed inset-0 z-[2147483003] size-full",
          !reduced && "transition-opacity duration-200",
          snap.shown ? "opacity-100" : "opacity-0",
        )}
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

/** How the agent's pen draws: in its colour, drawn in from the start unless motion is less. */
const strokeOf = (reduced: boolean) =>
  ({
    fill: "none",
    stroke: FILL,
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    pathLength: 1,
    strokeDasharray: 1,
    style: { animation: reduced ? undefined : "dt-draw 560ms cubic-bezier(.45,0,.2,1) both" },
  }) as const;

/** A box drawn by hand round the element, its corners a little loose. */
function boxPath(b: Box) {
  const l = b.left - 6;
  const t = b.top - 5;
  const r = b.left + b.width + 6;
  const bt = b.top + b.height + 5;
  return `M ${String(l + 2)} ${String(t)} L ${String(r + 3)} ${String(t + 1)} L ${String(r)} ${String(bt + 2)} L ${String(l - 1)} ${String(bt)} Z`;
}

/** A line through the middle of the element, as a pen strikes out words. */
function strike(b: Box) {
  const y = b.top + b.height / 2;
  return `M ${String(b.left - 4)} ${String(y + 2)} Q ${String(b.left + b.width / 2)} ${String(y - 3)} ${String(b.left + b.width + 4)} ${String(y)}`;
}

/** An arrow by hand: its line with a slight bow, and its head. */
function arrow(from: readonly [number, number], to: readonly [number, number]) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const bow = 0.12;
  const mx = (x1 + x2) / 2 - (y2 - y1) * bow;
  const my = (y1 + y2) / 2 + (x2 - x1) * bow;
  const a = Math.atan2(y2 - my, x2 - mx);
  const head = (turn: number) =>
    `${(x2 - 11 * Math.cos(a + turn)).toFixed(1)} ${(y2 - 11 * Math.sin(a + turn)).toFixed(1)}`;
  return `M ${String(x1)} ${String(y1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${String(x2)} ${String(y2)} M ${head(0.45)} L ${String(x2)} ${String(y2)} L ${head(-0.45)}`;
}

/** An ellipse by hand, as the loop is drawn, in a box of its own. */
function ellipse(at: readonly [number, number], size: readonly [number, number]) {
  const [x, y] = at;
  const [w, h] = size;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const points = Array.from({ length: 73 }, (_, i) => {
    const t = (i / 72) * Math.PI * 2 * 1.06;
    const r = 1 + 0.03 * (i / 72);
    return `${(cx + Math.cos(t - 2.2) * (w / 2) * r).toFixed(1)} ${(cy + Math.sin(t - 2.2) * (h / 2) * r).toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

/** One of the agent's own shapes, placed against the box of its element. Each draws in after
 * the one before it, as a hand draws them. */
function ShapeView({
  shape,
  box: b,
  stroke,
  delay,
}: {
  readonly shape: Shape;
  readonly box: Box;
  readonly stroke: ReturnType<typeof strokeOf>;
  readonly delay: number;
}) {
  const at = ([x, y]: readonly [number, number]) => [b.left + x, b.top + y] as const;
  const style = {
    animation: stroke.style.animation,
    animationDelay: `${String(delay)}ms`,
  };
  if (shape.kind === "text") {
    const [x, y] = at(shape.at);
    return (
      <text
        x={x}
        y={y}
        fill={FILL}
        className="font-[Caveat,'Segoe_Print','Bradley_Hand',cursive] text-[17px] font-semibold"
        style={{
          animation:
            stroke.style.animation === undefined ? undefined : "dt-fade 400ms ease-out both",
          animationDelay: style.animationDelay,
        }}
      >
        {shape.text}
      </text>
    );
  }
  const path = () => {
    switch (shape.kind) {
      case "arrow":
        return arrow(at(shape.from), at(shape.to));
      case "line":
        return `M ${at(shape.from).join(" ")} L ${at(shape.to).join(" ")}`;
      case "ellipse":
        return ellipse(at(shape.at), shape.size);
      case "rect": {
        const [x, y] = at(shape.at);
        const [w, h] = shape.size;
        return boxPath({ left: x + 6, top: y + 5, width: w - 12, height: h - 10 });
      }
    }
  };
  const d = path();
  return <path d={d} {...stroke} style={style} />;
}

/**
 * What the cursor draws on the element. A loop or a line draws in from the pen's start; the
 * frame of a turn draws in, then breathes until the reviewer clicks. The beat's own shapes
 * draw in after it, one by one, and the ring of a click spreads out and fades.
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
  const stroke = strokeOf(reduced);
  return (
    <svg
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[2147483003] size-full overflow-visible drop-shadow-[0_0_6px_rgb(74_108_247/0.55)]"
      style={going ? GONE : undefined}
    >
      {mark.draw === "circle" && (
        <path
          d={loop(box, aim(box, { width: innerWidth - PANEL, height: innerHeight }).tip)}
          {...stroke}
        />
      )}
      {mark.draw === "underline" && <path d={underline(box)} {...stroke} />}
      {mark.draw === "box" && <path d={boxPath(box)} {...stroke} />}
      {mark.draw === "strike" && <path d={strike(box)} {...stroke} />}
      {mark.draw === "press" && (
        <circle
          cx={aim(box, { width: innerWidth - PANEL, height: innerHeight }).tip.x}
          cy={aim(box, { width: innerWidth - PANEL, height: innerHeight }).tip.y}
          r={14}
          fill={FILL}
          fillOpacity={0.25}
          stroke={FILL}
          strokeWidth={2}
          className="origin-center [transform-box:fill-box]"
          style={{ animation: reduced ? undefined : "dt-press 600ms ease-out both" }}
        />
      )}
      {mark.shapes.map((shape, i) => (
        <ShapeView
          key={i}
          shape={shape}
          box={box}
          stroke={stroke}
          delay={(mark.draw === undefined ? 0 : 420) + i * 380}
        />
      ))}
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

/**
 * A mock-up in the element's place, in the element's own look, while the beat shows: the
 * agent shows a change before it makes it. It grows from the element's box, so longer words
 * still fit, and a faint ring says that it is not the page's own.
 */
function MockView({
  mock,
  going,
  reduced,
}: {
  readonly mock: Mock;
  readonly going: boolean;
  readonly reduced: boolean;
}) {
  const { box } = mock;
  return (
    <div
      aria-hidden
      data-mock={mock.key}
      className="pointer-events-none fixed z-[2147483002] overflow-visible"
      style={{
        ...mock.style,
        // The page has no panel tokens: the ring takes the agent's colour by its value.
        boxShadow: `0 0 0 3px #fff, 0 0 0 5px ${FILL}59`,
        left: box.left,
        top: box.top,
        // At least the element's size, and as wide as its words, so a longer one never wraps
        // inside the old one's width.
        width: "max-content",
        minWidth: box.width,
        maxWidth: Math.max(box.width, 480),
        minHeight: box.height,
        animation: going
          ? GONE.animation
          : reduced
            ? undefined
            : "dt-mock 360ms cubic-bezier(.3,1.4,.5,1) both",
      }}
      // The markup was cleaned of scripts and handlers by the walker.
      // oxlint-disable-next-line react/no-danger -- a mock-up from the agent, cleaned
      dangerouslySetInnerHTML={mock.html === undefined ? undefined : { __html: mock.html }}
    >
      {mock.html === undefined ? mock.text : undefined}
    </div>
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
        "blueline fixed z-[2147483003] flex w-max origin-top-left flex-col gap-1.5 rounded-dt-panel bg-dt-panel p-2.5 text-dt-text shadow-dt-float",
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
          {Icon !== undefined ? (
            <Icon className="size-3" aria-hidden />
          ) : note.step === "" ? (
            <AgentMark className="size-2.5" />
          ) : (
            note.step
          )}
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
