import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  MousePointerClick,
  RotateCcw,
  X,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { STORED } from "../io/stored";
import { placePath } from "../part/page";
import { stepNoteId } from "../session/machine";
import type { StepInfo } from "../types";
import { focusToWrite } from "../vim";
import { useVariantPlace } from "./bar";
import { Chips, Composer, NoteState, Thread } from "./composer";
import { cx } from "./cx";
import { BAR, DOCK, FOCUSED, type Box } from "./geometry";
import { DragHandle, useCard } from "./overlays";
import { useSession, useStepNote, useTools, usePins } from "./session";
import { usePhone } from "./touch";

/*
 * The step's card, beside the lit part: where the reviewer is, what to look at and try,
 * and the chat with the agent. Its switch says whose chat it is: the step's, or the page's,
 * so the reviewer writes on the page and keeps their place in the journey. Its content
 * takes the card's full width. On a phone it is a sheet above the bar, which folds down to
 * the step's title, its variants and Settle, so the part shows.
 */

const WIDTH = 380;

/** Where the phone's sheet keeps whether it is folded, across steps and reloads. */
const FOLDED = `${STORED}:card-folded`;

const storedFold = () => {
  try {
    return localStorage.getItem(FOLDED) === "1";
  } catch {
    return false;
  }
};

/** On a phone, a card stands as a sheet above the bar, as wide as the screen. */
export const SHEET =
  "max-sm:inset-x-2 max-sm:bottom-(--dt-above-bar) max-sm:max-h-[calc(100dvh-var(--dt-above-bar)-env(safe-area-inset-top)-16px)] max-sm:overflow-y-auto max-sm:overscroll-contain";

/** A small button in a card's corner: 44 px on a phone, for a finger. */
const CORNER =
  "grid size-5 shrink-0 place-items-center rounded-dt-control text-dt-faint hover:bg-dt-raised hover:text-dt-text max-sm:size-11";

export function StepCard({
  step,
  at,
  count,
  box,
}: {
  readonly step: StepInfo;
  readonly at: number;
  readonly count: number;
  readonly box: Box | undefined;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(200);
  useLayoutEffect(() => {
    const h = card.current?.offsetHeight;
    if (h !== undefined && Math.abs(h - height) > 1) setHeight(h);
  });
  const place = useVariantPlace();
  const settled = useSession((s) => s.context.feedback[step.id]?.settled === true);
  const phone = usePhone();
  const [folded, setFolded] = useState(storedFold);
  const fold = (to: boolean) => {
    setFolded(to);
    try {
      localStorage.setItem(FOLDED, to ? "1" : "0");
    } catch {
      // A browser without storage keeps the fold until the page reloads.
    }
  };
  const shut = phone && folded;
  const drag = useCard(step.id, box, { width: WIDTH, height });
  const where = drag.place ?? {
    left: Math.max(12, (window.innerWidth - WIDTH) / 2),
    top: window.innerHeight - BAR - 12 - height,
  };
  const { actor } = useTools();
  const onPage = useSession((s) => s.context.chat === "page");
  const pagePlace = useSession((s) => s.context.place);
  // Tab in the field writes to the other chat, in the same mode, as Tab on the page does.
  const flip = (insert: boolean) => {
    actor.send({ type: "chat" });
    requestAnimationFrame(() => {
      const field = card.current?.querySelector<HTMLElement>("[data-dt-composer=step]") ?? null;
      if (insert) focusToWrite(field);
      else field?.focus();
    });
  };
  return (
    <div
      {...DOCK}
      ref={card}
      role="region"
      aria-label={onPage ? "This page" : `Step ${at + 1}: ${step.title}`}
      className={cx(
        "group/card fixed z-[2147483002] flex flex-col gap-2.5 rounded-dt-panel bg-dt-panel p-3.5 text-dt-text shadow-dt-float",
        FOCUSED,
        SHEET,
        drag.dragging
          ? "select-none"
          : "transition-[left,top] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]",
      )}
      style={phone ? undefined : { width: WIDTH, left: where.left, top: where.top }}
    >
      {!phone && <DragHandle onPointerDown={drag.onPointerDown} />}
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[11px] text-dt-muted max-sm:text-[13px]">
          <Switch onPage={onPage} />
          {onPage ? (
            <span className="min-w-0 truncate">{placePath(pagePlace)}</span>
          ) : (
            <>
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                {at + 1} of {count}
              </span>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">{step.group.title}</span>
            </>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Reset the step"
              title="Reset the step: build its page again from the start"
              onClick={() => actor.send({ type: "reset" })}
              className={CORNER}
            >
              <RotateCcw className="size-3 max-sm:size-4" aria-hidden />
            </button>
            {phone && (
              <button
                type="button"
                aria-label={folded ? "Show the step" : "Fold the step"}
                aria-expanded={!folded}
                onClick={() => fold(!folded)}
                className={CORNER}
              >
                {folded ? (
                  <ChevronUp className="size-4" aria-hidden />
                ) : (
                  <ChevronDown className="size-4" aria-hidden />
                )}
              </button>
            )}
          </span>
        </span>
        <span className="text-[14px] leading-5 font-semibold max-sm:text-[16px]">
          {onPage ? "This page" : step.title}
        </span>
      </div>
      {!onPage && (
        <div className="flex items-center gap-1">
          {place !== undefined && <VariantSwitch place={place} />}
          <SettleButton settled={settled} />
        </div>
      )}
      {!shut && !onPage && (
        <p className="text-[13px] leading-[1.45] text-dt-muted max-sm:text-[15px]">{step.look}</p>
      )}
      {!shut && !onPage && step.try !== undefined && (
        <p className="flex items-start gap-2 text-[13px] leading-[1.45] text-dt-text max-sm:text-[15px]">
          <MousePointerClick className="mt-0.5 size-3.5 shrink-0 text-dt-accent" aria-hidden />
          {step.try}
        </p>
      )}
      {/* Folded, the chat is not mounted: a reply that comes in stays unread until it shows. */}
      {!shut && (
        <div className="flex flex-col gap-2 border-t border-dt-line pt-2.5">
          {onPage ? (
            <StepChat
              key={pagePlace}
              step={pagePlace}
              placeholder="A message on this page"
              onTab={flip}
            />
          ) : (
            <StepChat key={step.id} step={step.id} onTab={flip} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The page's card, off a step: the chat with the agent on this page. A note pointed at an
 * element with Alt goes to the agent with the next message.
 */
export function PageCard({ place }: { readonly place: string }) {
  const card = useRef<HTMLDivElement>(null);
  // The chat in it grows without the card drawing again, so its size is watched.
  const [height, setHeight] = useState(160);
  useLayoutEffect(() => {
    const el = card.current;
    if (el === null) return;
    const watch = new ResizeObserver(() => setHeight(el.offsetHeight));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const drag = useCard(place, undefined, { width: WIDTH, height });
  const phone = usePhone();
  // It stands on the bar and grows up, as a chat does, until the reviewer drags it.
  const at =
    drag.place === undefined
      ? { left: Math.max(12, (window.innerWidth - WIDTH) / 2), bottom: BAR + 12 }
      : { left: drag.place.left, top: drag.place.top };
  const { actor } = useTools();
  return (
    <div
      {...DOCK}
      ref={card}
      role="region"
      aria-label="This page"
      // The fade's duration with no transition named would ease every change, a drag too.
      className={cx(
        "group/card fixed z-[2147483002] flex animate-in flex-col gap-2.5 rounded-dt-panel bg-dt-panel p-3.5 text-dt-text shadow-dt-float transition-none duration-150 fade-in",
        FOCUSED,
        SHEET,
        drag.dragging && "select-none",
      )}
      style={phone ? undefined : { width: WIDTH, ...at }}
    >
      {!phone && <DragHandle onPointerDown={drag.onPointerDown} />}
      <span className="flex items-center gap-1.5 text-[11px] text-dt-muted max-sm:text-[13px]">
        <span className="text-[14px] leading-5 font-semibold text-dt-text max-sm:text-[16px]">
          This page
        </span>
        <span className="min-w-0 truncate">{placePath(place)}</span>
        <button
          type="button"
          aria-label="Close"
          onClick={() => actor.send({ type: "page", open: false })}
          className={cx("ml-auto", CORNER)}
        >
          <X className="size-3" aria-hidden />
        </button>
      </span>
      <StepChat step={place} placeholder="A message on this page" />
    </div>
  );
}

/**
 * The chat with the agent on a step or a page: the thread, where it is with the agent, the
 * pointed notes that go with the next message, and the composer.
 */
export function StepChat({
  step,
  placeholder = "A message on this step",
  onTab,
}: {
  readonly step: string;
  readonly placeholder?: string;
  readonly onTab?: ((insert: boolean) => void) | undefined;
}) {
  const note = useStepNote(step);
  const pins = usePins(step);
  return (
    <>
      <Thread note={note} />
      <NoteState note={note} />
      <Chips pins={pins} />
      <Composer
        id={stepNoteId(step)}
        step={step}
        note={note}
        sends
        pointed={pins.length}
        placeholder={placeholder}
        onDone={() => undefined}
        onTab={onTab}
      />
    </>
  );
}

/** Which variant the page shows, of how many, with the previous and the next beside it, as
 * j and k and a swipe on the part go. */
function VariantSwitch({
  place,
}: {
  readonly place: { readonly at: number; readonly of: number; readonly label: string };
}) {
  const { perform } = useTools();
  const arrow =
    "grid size-6 shrink-0 place-items-center rounded-dt-control text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:size-11";
  return (
    <span
      role="group"
      aria-label="Variant"
      className="flex min-w-0 items-center gap-0.5 text-[12px] text-dt-muted max-sm:text-[14px]"
    >
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => perform({ kind: "variant", by: -1 })}
        className={arrow}
      >
        <ChevronLeft className="size-3.5 max-sm:size-4" aria-hidden />
      </button>
      <span className="min-w-0 truncate rounded-dt-mark bg-dt-raised px-1.5 py-px font-medium text-dt-text">
        {place.label}
      </span>
      <span className="shrink-0 px-1 whitespace-nowrap tabular-nums">
        {place.at + 1} of {place.of}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => perform({ kind: "variant", by: 1 })}
        className={arrow}
      >
        <ChevronRight className="size-3.5 max-sm:size-4" aria-hidden />
      </button>
    </span>
  );
}

/** Settles the step: it is right as it shows, with the variant the page shows; the walk then
 * goes on to the next open step. Pressed on a settled step, which a press opens again. */
function SettleButton({ settled }: { readonly settled: boolean }) {
  const { perform } = useTools();
  return (
    <button
      type="button"
      aria-pressed={settled}
      title={settled ? "Open the step again" : undefined}
      onClick={() => perform({ kind: "event", event: { type: "settle" } })}
      className={cx(
        "ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-dt-control px-2.5 text-[12px] font-medium max-sm:h-11 max-sm:px-4 max-sm:text-[15px]",
        settled
          ? "bg-dt-good/20 text-dt-good hover:bg-dt-good/30"
          : "bg-dt-accent text-white hover:bg-dt-accent/85",
      )}
    >
      <Check className="size-3.5 max-sm:size-4" aria-hidden />
      {settled ? "Settled" : "Settle"}
    </button>
  );
}

/** Whose chat the step's card has: the step's or the page's. A click or Tab switches. */
function Switch({ onPage }: { readonly onPage: boolean }) {
  const { actor } = useTools();
  const side = (to: "step" | "page", label: string) => {
    const on = onPage === (to === "page");
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => actor.send({ type: "chat", to })}
        className={cx(
          "rounded-dt-mark px-1.5 py-px max-sm:min-h-11 max-sm:px-3",
          on ? "bg-dt-raised font-medium text-dt-text" : "text-dt-muted hover:text-dt-text",
        )}
      >
        {label}
      </button>
    );
  };
  return (
    <span
      role="group"
      aria-label="Write to"
      className="flex shrink-0 gap-px rounded-dt-mark bg-dt-ground p-px"
    >
      {side("step", "Step")}
      {side("page", "Page")}
    </span>
  );
}
