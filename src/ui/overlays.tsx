import { GripHorizontal, LoaderCircle, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isKept, type Note } from "../notes/note";
import type { DevShift } from "../types";
import { cx } from "./cx";
import { useSession } from "./session";
import { GLIDE_MS, lightFrame, type Missing, type Motion } from "./light";
import { isPhone } from "./touch";
import {
  BAR,
  boxOf,
  inside,
  placeCard,
  PANEL,
  sameBox,
  under,
  UI,
  type Box,
  type Place,
  type Side,
} from "./geometry";

/*
 * What the dev tools draw over the page: the light on the part to look at, the reviewer's
 * pins, the crosshair to point with, and the card while a step's world changes. Each lets
 * clicks through to the page, except the crosshair.
 */

/** Calls `tick` on each frame while `on`. */
function useFrames(on: boolean, tick: () => void) {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const run = () => {
      latest.current();
      frame = requestAnimationFrame(run);
    };
    run();
    return () => cancelAnimationFrame(frame);
  }, [on]);
}

/** How far below the screen's top edge a phone puts the part under review. */
const TOP = 16;

/** When a finger last touched the page. */
let lastTouch = 0;
if (typeof window !== "undefined")
  window.addEventListener("touchstart", () => (lastTouch = performance.now()), {
    capture: true,
    passive: true,
  });

/** Scrolls the part to the top of a phone's screen, above the tools at the bottom. */
export function toTop(element: HTMLElement) {
  // Clear of the screen's top edge; the margin counts only for this scroll.
  const was = element.style.scrollMarginTop;
  element.style.scrollMarginTop = `${String(TOP)}px`;
  element.scrollIntoView({ block: "start", behavior: "smooth" });
  element.style.scrollMarginTop = was;
}

/** Follows the elements as the page scrolls and changes. Once for each key, it scrolls
 * them to the middle of the screen; a part taller than the screen starts at its top. On a
 * phone the step's card stands over the screen's lower part, so the part goes to the top. */
export function useBox(selectors: readonly string[], key: string): Box | undefined {
  const [box, setBox] = useState<Box | undefined>(undefined);
  const joined = selectors.join("|");
  const scrolled = useRef("");
  useFrames(joined !== "", () => {
    const list = joined.split("|");
    const next = boxOf(list);
    if (next !== undefined && scrolled.current !== `${key}|${joined}`) {
      scrolled.current = `${key}|${joined}`;
      const first = list.map((s) => document.querySelector(s)).find((e) => e !== null);
      const tall = next.height > window.innerHeight - BAR - 24;
      const phone = isPhone();
      if (first instanceof HTMLElement && phone) {
        const at = scrolled.current;
        const opened = performance.now();
        toTop(first);
        // The page may scroll its own way as the step opens, as to centre a field; on a
        // phone that puts the part under the tools. Once that scroll is done, the part goes
        // to the top again, unless the reviewer has touched the page since.
        for (const ms of [600, 1200])
          window.setTimeout(() => {
            const off = Math.abs(first.getBoundingClientRect().top - TOP) > 24;
            if (scrolled.current === at && lastTouch < opened && off) toTop(first);
          }, ms);
      } else first?.scrollIntoView({ block: tall ? "start" : "center", behavior: "smooth" });
    }
    setBox((was) => (sameBox(was, next) ? was : next));
  });
  useEffect(() => {
    if (joined === "") setBox(undefined);
  }, [joined]);
  return box;
}

/** The box of one element, as the page scrolls. */
export function useElementBox(selector: string | undefined): Box | undefined {
  return useBox(selector === undefined ? [] : [selector], selector ?? "");
}

/**
 * Where a card goes beside a box, and how the reviewer drags it. While `key` stays the same,
 * the card keeps the side it took as long as it fits there, and a card the reviewer dragged
 * stays where it was put.
 */
export function useCard(
  key: string,
  box: Box | undefined,
  card: { readonly width: number; readonly height: number },
  prefer?: Side,
): {
  readonly place: Place | undefined;
  readonly dragging: boolean;
  readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
} {
  const kept = useRef<{ readonly key: string; readonly side: Side } | undefined>(undefined);
  const [moved, setMoved] = useState<{ readonly key: string; readonly place: Place }>();
  const [dragging, setDragging] = useState(false);
  // The docked panel is on the right; a card stays off it.
  const docked = useSession((s) => s.context.panel && !s.context.preview) && !isPhone();
  const screen = {
    width: window.innerWidth - (docked ? PANEL : 0),
    height: window.innerHeight,
  };
  const stays = kept.current?.key === key ? kept.current.side : undefined;
  const place =
    moved?.key === key
      ? inside(moved.place, card, screen)
      : box === undefined
        ? undefined
        : placeCard(box, card, screen, prefer, stays);
  const side = moved?.key === key ? undefined : place?.side;
  useLayoutEffect(() => {
    if (side !== undefined) kept.current = { key, side };
  }, [key, side]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // A card with no part to stand by, as the page's, starts from where it is.
    const card = e.currentTarget.parentElement?.getBoundingClientRect();
    const start = place ?? card;
    if (e.button !== 0 || start === undefined) return;
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY, left: start.left, top: start.top };
    setDragging(true);
    // The grip keeps the pointer, so a finger that leaves it still drags.
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) =>
      setMoved({
        key,
        place: { left: from.left + m.clientX - from.x, top: from.top + m.clientY - from.y },
      });
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return { place, dragging, onPointerDown };
}

/** The grip at the top of a floating card, which drags it. Its dots show on the card's
 * hover, and always on a screen with no hover; it sits in the card's top padding, so the
 * card's content does not move. */
export function DragHandle({
  onPointerDown,
}: {
  readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  return (
    <div
      aria-hidden
      onPointerDown={onPointerDown}
      className="absolute inset-x-0 top-0 flex h-3.5 cursor-grab touch-none items-start justify-center text-dt-faint opacity-0 transition-opacity group-hover/card:opacity-100 hover:text-dt-muted active:cursor-grabbing [@media(hover:none)]:opacity-100"
    >
      <GripHorizontal className="size-3.5" />
    </div>
  );
}

/** Which variant the page shows, of how many. */
type VariantPlace = { readonly at: number; readonly of: number; readonly label: string };

/** While the tools are hidden, a short outline on the part as the walk opens a step, builds it
 * again or shows another variant: the reviewer sees what the step is about, and which variant
 * the page shows, and the page stays clean. */
export function Flash({
  box,
  place,
}: {
  readonly box: Box;
  readonly place?: VariantPlace | undefined;
}) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const off = window.setTimeout(() => setOn(false), 900);
    return () => window.clearTimeout(off);
  }, []);
  return (
    <div
      {...UI}
      aria-hidden
      className={cx(
        "pointer-events-none fixed z-[2147483000] rounded-[12px] ring-2 ring-dt-accent transition-opacity duration-500",
        on ? "opacity-100" : "opacity-0",
      )}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      {place !== undefined && <VariantTab place={place} />}
    </div>
  );
}

/** How near the screen's edge the check's middle may come, in px: it shows whole. */
const CHECK_EDGE = 12;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the page is, as a router has it, so the light knows the next part is on another page. */
const pageNow = () => `${location.pathname}${location.hash}`;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

const between = (from: Box, to: Box, t: number): Box => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
  width: from.width + (to.width - from.width) * t,
  height: from.height + (to.height - from.height) * t,
});

/**
 * The light around the step's part: the page dims a little around it. With more than one
 * variant, a tab on its edge shows which one the page shows, of how many, so the reviewer sees
 * there are more to look at. It follows the part at once, as the page scrolls or narrows for
 * the panel: an eased follow would trail behind the part.
 *
 * It stays while the walk goes on to the next step, and once the next part shows, it glides
 * there and gives one soft pulse, so the eye follows where to look next. The page scrolls to
 * the part first. On another page, and with reduced motion, it fades in instead. A settled
 * step's light is green, with a check in its corner: the settle turns it, and undo turns it
 * back. `onPlaced` says when the light stands on the step `at` names.
 */
export function Light({
  box,
  at,
  ready,
  settled,
  place,
  turning = false,
  left,
  onPlaced,
}: {
  readonly box: Box | undefined;
  /** The step shown, as the run and its index name it. */
  readonly at: string;
  /** Whether the step's world is open, so its part shows if it has one. */
  readonly ready: boolean;
  readonly settled: boolean;
  readonly place?: VariantPlace | undefined;
  /** Whether undo or redo took the walk to the step: its light arrives in its old look, with
   * no motion, and turns once it stands on the part. */
  readonly turning?: boolean;
  /** The step a settle went on from, as `at` names it, and its part's selectors: its part
   * shows the settle as the light leaves it. */
  readonly left?: { readonly at: string; readonly target: readonly string[] } | undefined;
  readonly onPlaced: (at: string) => void;
}) {
  const [motion, setMotion] = useState<Motion>({ kind: "fading", at: "" });
  const [settles, setSettles] = useState<readonly Settled[]>([]);
  const [pulse, setPulse] = useState(0);
  // Each fade in draws a new light, so it does not turn from the last step's look.
  const [fades, setFades] = useState(0);
  const [, redraw] = useState(0);
  const latest = useRef({ box, at, ready, motion, left, onPlaced });
  latest.current = { box, at, ready, motion, left, onPlaced };
  // The box the light last drew round a part that showed, and on which page.
  const drawn = useRef<{ readonly box: Box; readonly page: string } | undefined>(undefined);
  const missing = useRef<Missing | undefined>(undefined);
  useFrames(true, () => {
    const { box, at, ready, motion: m, left, onPlaced } = latest.current;
    const next = lightFrame(m, missing.current, {
      box,
      at,
      ready,
      left: left?.at,
      now: performance.now(),
      page: pageNow(),
      reduced: reducedMotion,
      drawn: drawn.current,
    });
    missing.current = next.missing;
    if (next.motion !== m) {
      latest.current = { ...latest.current, motion: next.motion };
      setMotion(next.motion);
    }
    if (next.fade === true) setFades((n) => n + 1);
    if (next.pulse === true) setPulse((n) => n + 1);
    if (next.redraw === true) redraw((n) => (n + 1) % 1024);
    if (next.placed !== undefined) onPlaced(next.placed);
  });
  const rect =
    motion.kind === "waiting"
      ? motion.from
      : motion.kind === "gliding" && box !== undefined
        ? between(
            motion.from,
            box,
            easeOut(Math.min((performance.now() - motion.start) / GLIDE_MS, 1)),
          )
        : motion.at === at
          ? (box ?? drawn.current?.box)
          : drawn.current?.box;
  // While the next step opens, the light stays where it was, and the page it was on.
  useLayoutEffect(() => {
    if (box !== undefined && rect !== undefined && motion.at === at)
      drawn.current = { box: rect, page: pageNow() };
  });
  // A settle went on from the step the light stands on: its part shows the settle, where the
  // light last stood, as the light leaves.
  const leftAt = left?.at;
  const leftTarget = left?.target.join("|") ?? "";
  useLayoutEffect(() => {
    const from = drawn.current;
    if (leftAt === undefined || from === undefined) return;
    const id = `${leftAt}-${String(performance.now())}`;
    const target = leftTarget === "" ? [] : leftTarget.split("|");
    setSettles((all) => [...all, { id, box: from.box, target }]);
  }, [leftAt, leftTarget]);
  // Until the light leaves for the next part, it keeps the look of the step it stands on: a
  // settled one stays green as the walk goes on.
  const held = useRef(settled);
  const here = motion.at === at && motion.kind !== "waiting";
  if (here) held.current = settled;
  const look = here ? settled : held.current;
  const instant = turning && (!here || motion.kind === "gliding") ? "transition-none" : undefined;
  return (
    <>
      {settles.map((s) => (
        <SettledPart
          key={s.id}
          box={s.box}
          target={s.target}
          onDone={() => setSettles((all) => all.filter((o) => o.id !== s.id))}
        />
      ))}
      {rect !== undefined && (
        <div
          key={fades}
          {...UI}
          aria-hidden
          data-dt-motion={motion.kind}
          className={cx(
            "pointer-events-none fixed inset-0 z-[2147483000] transition-opacity duration-150",
            motion.kind === "gone" ? "opacity-0" : "opacity-100 starting:opacity-0",
          )}
        >
          <svg className="absolute inset-0 size-full">
            <defs>
              <mask id="blueline-light">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  style={{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }}
                  rx="12"
                  fill="black"
                />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.18)" mask="url(#blueline-light)" />
          </svg>
          <div
            data-dt-light={look ? "settled" : "open"}
            className={cx(
              "absolute rounded-[12px] ring-2 transition-shadow duration-200",
              look ? "ring-dt-good" : "ring-dt-accent delay-150",
              instant,
            )}
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          >
            {pulse > 0 && (
              <span
                key={pulse}
                className={cx(
                  "absolute inset-0 animate-dt-pulse rounded-[12px] motion-reduce:hidden",
                  look ? "text-dt-good" : "text-dt-accent",
                )}
              />
            )}
            <SettleCheck
              settled={look}
              instant={instant}
              // On the corner, but never past the screen's edge, as a phone's part stands near it.
              at={{ x: Math.max(0, CHECK_EDGE - rect.x), y: Math.max(0, CHECK_EDGE - rect.y) }}
            />
            {place !== undefined && <VariantTab place={place} settled={look} instant={instant} />}
          </div>
        </div>
      )}
    </>
  );
}

/** A part that a settle left: where the light stood, and its selectors, to follow it. */
interface Settled {
  readonly id: string;
  readonly box: Box;
  readonly target: readonly string[];
}

/** The settle on the part it left: a green outline and a check that draws in, which stand
 * and then fade as the light glides on. It follows the part as the page scrolls, and stays
 * where the light stood until the part goes, as to another page; then it leaves. With reduced
 * motion the check does not draw: the outline and the check only fade. */
function SettledPart({
  box,
  target,
  onDone,
}: {
  readonly box: Box;
  readonly target: readonly string[];
  /** Its motion has ended: it leaves. */
  readonly onDone: () => void;
}) {
  const [, redraw] = useState(0);
  useFrames(true, () => redraw((n) => (n + 1) % 1024));
  const live = boxOf(target);
  // Its part has gone, as the walk went to another page: nothing there is settled. It stays
  // unseen until its motion ends.
  const gone = live === undefined && target.length > 0;
  const rect = live ?? box;
  return (
    <div
      {...UI}
      aria-hidden
      data-dt-settled-part=""
      onAnimationEnd={(e) => {
        if (e.animationName === "dt-left") onDone();
      }}
      className={cx(
        "pointer-events-none fixed inset-0 z-[2147483000] animate-dt-left",
        gone && "invisible",
      )}
    >
      <div
        className="absolute rounded-[12px] ring-2 ring-dt-good"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        <span
          style={{ left: Math.max(0, CHECK_EDGE - rect.x), top: Math.max(0, CHECK_EDGE - rect.y) }}
          className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-dt-good"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none">
            <path
              d="M6 10.5 8.6 13 14 7.5"
              pathLength={1}
              stroke="white"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={1}
              className="animate-dt-draw motion-reduce:animate-none"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}

/** The check in the light's corner on a settled step. It draws in as the step settles, and
 * draws out as undo opens it again; with reduced motion it only fades. */
function SettleCheck({
  settled,
  instant,
  at,
}: {
  readonly settled: boolean;
  readonly instant?: string | undefined;
  readonly at: { readonly x: number; readonly y: number };
}) {
  return (
    <span
      data-dt-check={settled ? "on" : "off"}
      style={{ left: at.x, top: at.y }}
      className={cx(
        "absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-dt-good transition-opacity duration-150",
        settled ? "opacity-100" : "opacity-0 delay-200 motion-reduce:delay-0",
        instant,
      )}
    >
      <svg viewBox="0 0 20 20" className="size-5" fill="none">
        <path
          d="M6 10.5 8.6 13 14 7.5"
          pathLength={1}
          stroke="white"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={1}
          className={cx(
            "transition-[stroke-dashoffset] duration-250 ease-out motion-reduce:transition-none motion-reduce:[stroke-dashoffset:0]",
            settled ? "[stroke-dashoffset:0] delay-100" : "[stroke-dashoffset:1]",
            instant,
          )}
        />
      </svg>
    </span>
  );
}

/** The tab on the light's edge: a dot for each variant, the one the page shows bright. It
 * takes the light's colour. */
function VariantTab({
  place,
  settled = false,
  instant,
}: {
  readonly place: VariantPlace;
  readonly settled?: boolean;
  readonly instant?: string | undefined;
}) {
  return (
    <span
      title={`${place.label}, ${String(place.at + 1)} of ${String(place.of)}`}
      className={cx(
        "absolute top-0 right-3 flex h-3.5 -translate-y-1/2 items-center gap-1 rounded-full px-1.5 text-[9px] leading-none font-semibold text-white tabular-nums transition-colors duration-200",
        settled ? "bg-dt-good" : "bg-dt-accent delay-150",
        instant,
      )}
    >
      {place.of <= 6
        ? Array.from({ length: place.of }, (_, i) => (
            <span
              key={i}
              className={cx("size-1.5 rounded-full", i === place.at ? "bg-white" : "bg-white/40")}
            />
          ))
        : `${String(place.at + 1)}/${String(place.of)}`}
    </span>
  );
}

/** The colour of a pin: where its note is. */
export const pinTone = (n: Note) =>
  n.state === "replied"
    ? "bg-dt-warn text-dt-ground"
    : n.state === "settled"
      ? "bg-dt-good text-dt-ground"
      : n.state === "waiting" || n.state === "working"
        ? "bg-dt-accent text-white"
        : "bg-dt-text text-dt-ground";

/** A numbered dot at each element the reviewer pointed at on this step, for the notes not
 * sent yet. A dot opens its note. A sent note has no dot, but keeps its number. */
export function Pins({
  pins,
  open,
  onOpen,
}: {
  readonly pins: readonly Note[];
  readonly open: string | undefined;
  readonly onOpen: (id: string) => void;
}) {
  const [, redraw] = useState(0);
  useFrames(pins.length > 0, () => redraw((n) => (n + 1) % 1024));
  return (
    <div {...UI} className="pointer-events-none fixed inset-0 z-[2147483001]">
      {pins.map((pin, i) => {
        const selector = pin.pin?.selector;
        // A sent note leaves the page: the chat of its step or page has it, with its number.
        // It shows again while it is open, or has words not sent.
        const sent = pin.thread.length > 0 && !isKept(pin);
        const rect =
          selector === undefined || pin.pin?.variant !== undefined || (sent && open !== pin.id)
            ? undefined
            : document.querySelector(selector)?.getBoundingClientRect();
        if (rect === undefined) return null;
        return (
          <button
            type="button"
            key={pin.id}
            aria-label={`Annotation ${i + 1}: ${pin.thread.at(-1)?.text ?? (pin.draft || pin.pin?.what)}`}
            // A note with words on its pin waits for the next message.
            title={isKept(pin) && open !== pin.id ? "Waits for the next message" : undefined}
            onClick={() => onOpen(pin.id)}
            className={cx(
              "pointer-events-auto absolute grid size-5 -translate-y-1/2 place-items-center rounded-full text-[10px] leading-none font-semibold tabular-nums shadow-dt-float transition-transform hover:scale-110 max-sm:before:absolute max-sm:before:-inset-3 max-sm:before:content-['']",
              pinTone(pin),
              open === pin.id && "scale-125",
            )}
            style={{ left: rect.right + 4, top: rect.top }}
          >
            {pin.unread && (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-dt-bad" />
            )}
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

/** The crosshair, while the reviewer holds Alt or after the pin button: it lights the
 * element under the mouse or the finger, and a click or a tap points at it. */
export function Pointer({
  at,
  onPick,
}: {
  readonly at: { readonly x: number; readonly y: number };
  readonly onPick: (element: Element) => void;
}) {
  const [over, setOver] = useState<Element | undefined>(() =>
    at.x < 0 ? undefined : under(at.x, at.y),
  );
  const rect = over?.getBoundingClientRect();
  return (
    <div
      {...UI}
      className="fixed inset-0 z-[2147483003] cursor-crosshair"
      onPointerDown={(e) => setOver(under(e.clientX, e.clientY))}
      onPointerMove={(e) => setOver(under(e.clientX, e.clientY))}
      onClick={(e) => {
        e.preventDefault();
        const element = under(e.clientX, e.clientY);
        if (element !== undefined) onPick(element);
      }}
    >
      {rect !== undefined && (
        <div
          className="pointer-events-none absolute rounded-dt-mark bg-dt-warn/10 ring-2 ring-dt-warn"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      )}
    </div>
  );
}

/** While the pin button points: what to do next, as the screen shows no crosshair to a
 * finger, and a way out. */
export function AimHint({ onCancel }: { readonly onCancel: () => void }) {
  return (
    <div
      {...UI}
      role="status"
      className="fixed top-3 left-1/2 z-[2147483004] flex -translate-x-1/2 animate-in items-center gap-1 rounded-full bg-dt-panel py-0.5 pr-0.5 pl-3 text-[13px] whitespace-nowrap text-dt-text shadow-dt-float duration-150 fade-in"
    >
      Point at what the annotation is about
      <button
        type="button"
        aria-label="Stop pointing"
        onClick={onCancel}
        className="grid size-7 place-items-center rounded-full text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:size-11"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** While a step's world changes: where the reviewer is now, and who. */
export function Shift({ shift }: { readonly shift: DevShift }) {
  const initials = (shift.person?.name ?? "")
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2);
  return (
    <div
      {...UI}
      className="fixed inset-0 z-[2147483004] grid animate-in place-items-center bg-black/40 backdrop-blur-sm duration-300 fade-in"
    >
      <div className="flex w-80 flex-col items-center gap-3 rounded-dt-panel bg-dt-panel px-7 py-6 text-center text-dt-text shadow-dt-float">
        <span className="text-[15px] font-semibold">{shift.title}</span>
        {shift.detail !== undefined && (
          <span className="text-[12px] text-dt-muted">{shift.detail}</span>
        )}
        {shift.person !== undefined && (
          <span className="flex items-center gap-2.5 rounded-dt-control bg-dt-raised px-3 py-2">
            <span className="grid size-8 place-items-center rounded-full bg-dt-text text-[12px] leading-none font-semibold text-dt-ground">
              {initials}
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[13px]">{shift.person.name}</span>
              {shift.person.role !== undefined && (
                <span className="text-[11px] text-dt-muted">{shift.person.role}</span>
              )}
            </span>
          </span>
        )}
        {shift.busy && <LoaderCircle className="size-4 animate-spin text-dt-muted" aria-hidden />}
      </div>
    </div>
  );
}
