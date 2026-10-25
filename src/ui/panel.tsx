import {
  ChevronDown,
  ChevronRight,
  CircleQuestionMark,
  EyeOff,
  MousePointerClick,
  PanelRightClose,
  RotateCcw,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placePath } from "../part/page";
import { stepNoteId, treeShown } from "../session/machine";
import { focusToWrite } from "../vim";
import { Chips, Composer, NoteState, Thread } from "./composer";
import { cx } from "./cx";
import { DOCK, FOCUSED, PANEL } from "./geometry";
import { usePins, useSession, useStep, useStepNote, useTools } from "./session";
import {
  ICON,
  LiftButton,
  SettleButton,
  StepArrow,
  useVariantPlace,
  useVariety,
  VariantSwitch,
} from "./step-controls";
import { usePhone } from "./touch";
import { TreeZone } from "./tree";

/*
 * The panel at the right: where the reviewer is, what to look at and try, and the chat with
 * the agent. While a step is open, the tree of pages and journeys folds to one line at its
 * top; under it are the step's header, its words and its chat. Off a step, it shows the tree
 * and the page's chat in the same place. It docks: the page narrows by its width, so it covers
 * nothing. Hidden, the bar is its folded form. On a phone it is a sheet at the bottom.
 */

/** How long the panel takes to slide in or out; the page narrows and widens with it. */
const MOTION = 200;
const EASE = "cubic-bezier(.2,.8,.2,1)";

/** On a phone, a card stands as a sheet above the bar, as wide as the screen. */
export const SHEET =
  "max-sm:inset-x-2 max-sm:bottom-(--dt-above-bar) max-sm:max-h-[calc(100dvh-var(--dt-above-bar)-env(safe-area-inset-top)-16px)] max-sm:overflow-y-auto max-sm:overscroll-contain";

/** Whether the panel is on the screen: at once when it shows, and until its slide out ends. */
function usePresent(on: boolean): boolean {
  const [present, setPresent] = useState(on);
  if (on && !present) setPresent(true);
  useEffect(() => {
    if (on) return;
    const gone = window.setTimeout(() => setPresent(false), MOTION);
    return () => window.clearTimeout(gone);
  }, [on]);
  return present;
}

/**
 * Narrows the page by the panel's width while `on`, with the panel's motion, both ways: a
 * margin on the document's root, so the page lays itself out in the room left. The root's own
 * inline margin and transition come back when the tools go.
 */
function useDock(on: boolean) {
  const was = useRef<{ readonly margin: string; readonly transition: string }>(undefined);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const own = { margin: root.style.marginRight, transition: root.style.transition };
    was.current = own;
    return () => {
      root.style.marginRight = own.margin;
      root.style.transition = own.transition;
    };
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const own = was.current;
    if (own === undefined) return;
    root.style.transition = `margin-right ${String(MOTION)}ms ${EASE}`;
    root.style.marginRight = on ? `${String(PANEL)}px` : own.margin;
    const settled = window.setTimeout(() => {
      root.style.transition = own.transition;
    }, MOTION + 50);
    return () => window.clearTimeout(settled);
  }, [on]);
}

export function Panel() {
  const { actor, perform } = useTools();
  const shown = useSession((s) => s.context.panel && !s.context.preview);
  const active = useSession((s) => s.context.active);
  const tree = useSession((s) => s.context.tree);
  const phone = usePhone();
  const present = usePresent(shown);
  useDock(shown && !phone);
  if (!present) return null;
  const unfolded = treeShown({ active, tree }, phone);
  // It slides in from the side it docks on, and out again the same way.
  const away = phone ? "translate-y-[calc(100%+16px)]" : "translate-x-full";
  const coming = phone ? "starting:translate-y-[calc(100%+16px)]" : "starting:translate-x-full";
  return (
    <aside
      {...DOCK}
      data-dt-panel=""
      aria-label="Blueline"
      inert={!shown}
      className={cx(
        "fixed z-[2147483002] flex flex-col bg-dt-panel text-dt-text transition-[translate] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]",
        phone
          ? "inset-x-2 bottom-(--dt-base) max-h-[calc(100dvh-var(--dt-base)-env(safe-area-inset-top)-16px)] rounded-dt-panel shadow-dt-float"
          : "inset-y-0 right-0 border-l border-dt-line ring-inset",
        FOCUSED,
        shown ? `translate-x-0 translate-y-0 ${coming}` : away,
      )}
      style={phone ? undefined : { width: PANEL }}
    >
      <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-dt-line px-1.5 max-sm:h-14">
        {active || phone ? (
          <TreeLine unfolded={unfolded} />
        ) : (
          <span className="min-w-0 flex-1 truncate px-2.5 text-[11px] font-medium text-dt-faint">
            Pages
          </span>
        )}
        {active && (
          <button
            type="button"
            aria-label="Reset the step"
            title="Reset the step: build its page again from the start"
            onClick={() => actor.send({ type: "reset" })}
            // A phone keeps the room for the line: the `?` menu builds the step again too.
            className={cx(ICON, "max-sm:hidden")}
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          aria-label="Hide the tools"
          title="Hide the tools to see the page as a user does"
          onClick={() => perform({ kind: "event", event: { type: "preview" } })}
          // A phone has no room for it: the `?` menu hides the tools too.
          className={cx(ICON, "max-sm:hidden")}
        >
          <EyeOff className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Keys and commands"
          title="Keys and commands"
          onClick={() => perform({ kind: "event", event: { type: "open", layer: "help" } })}
          className={ICON}
        >
          <CircleQuestionMark className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Hide the panel"
          title="Hide the panel"
          onClick={() => perform({ kind: "panel" })}
          className={ICON}
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col max-sm:flex-initial">
        {active ? (
          // The tree unfolds over the step, which keeps its place under it.
          <div
            className={cx(
              "flex min-h-0 flex-1 flex-col max-sm:flex-initial",
              unfolded && "invisible max-sm:hidden",
            )}
          >
            <StepView />
          </div>
        ) : (
          <>
            {unfolded && (
              <TreeZone
                heading={phone}
                className="min-h-0 flex-1 overflow-y-auto max-sm:max-h-[45dvh] max-sm:flex-initial"
              />
            )}
            <PageView ruled={unfolded} />
          </>
        )}
        {active && unfolded && (
          <TreeZone
            heading
            className="absolute inset-0 overflow-y-auto bg-dt-panel max-sm:static max-sm:max-h-[60dvh]"
          />
        )}
      </div>
    </aside>
  );
}

/** The tree folded to one line, at the panel's top: the journey and the group on a step. A
 * click unfolds it, and so does a key of the tree's, as j, that comes while it has the keys. */
function TreeLine({ unfolded }: { readonly unfolded: boolean }) {
  const { actor } = useTools();
  const { journey, step } = useStep();
  const active = useSession((s) => s.context.active);
  const Icon = unfolded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      data-dt-zone="panel"
      aria-expanded={unfolded}
      aria-label={unfolded ? "Fold the pages and journeys" : "Pages and journeys"}
      onClick={() => actor.send({ type: "tree" })}
      className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-dt-control px-1.5 text-left text-[12px] text-dt-muted outline-none hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:text-[14px]"
    >
      <Icon className="size-3 shrink-0 text-dt-faint" aria-hidden />
      {active && journey !== undefined ? (
        <>
          <span className="min-w-0 shrink truncate text-dt-text">{journey.title}</span>
          {step !== undefined && step.group.title !== journey.title && (
            <>
              <span aria-hidden className="text-dt-faint">
                ·
              </span>
              <span className="min-w-0 shrink-[2] truncate">{step.group.title}</span>
            </>
          )}
        </>
      ) : (
        <span className="truncate">Pages and journeys</span>
      )}
    </button>
  );
}

/** The step in the panel: its header, its words, and its chat at the bottom. Its switch says
 * whose chat it is: the step's, or the page's, so the reviewer writes on the page and keeps
 * their place in the journey. */
function StepView() {
  const { actor } = useTools();
  const { step, at } = useStep();
  const place = useVariantPlace();
  const variety = useVariety();
  const onPage = useSession((s) => s.context.chat === "page");
  const pagePlace = useSession((s) => s.context.place);
  const chat = useRef<HTMLDivElement>(null);
  // Tab in the field writes to the other chat, in the same mode, as Tab on the page does.
  const flip = (insert: boolean) => {
    actor.send({ type: "chat" });
    requestAnimationFrame(() => {
      const field = chat.current?.querySelector<HTMLElement>("[data-dt-composer=step]") ?? null;
      if (insert) focusToWrite(field);
      else field?.focus();
    });
  };
  if (step === undefined)
    return (
      <>
        <p className="px-4 py-3 text-[13px] text-dt-muted">This page shows no part with variants</p>
        <PageView ruled />
      </>
    );
  return (
    <>
      <section
        aria-label={`Step ${String(at + 1)}: ${step.title}`}
        className="flex shrink-0 flex-col gap-2.5 px-1.5 pt-2 pb-3"
      >
        <div className="flex items-center gap-0.5">
          <StepArrow by={-1} />
          <span className="w-4 shrink-0 text-right text-[12px] text-dt-faint tabular-nums">
            {at + 1}
          </span>
          <span className="min-w-0 flex-1 truncate px-1.5 text-[14px] leading-5 font-semibold max-sm:text-[16px]">
            {step.title}
          </span>
          <StepArrow by={1} />
          {/* On a phone it is a check alone, so the title has room. */}
          <span className="pl-1">
            <SettleButton compact />
          </span>
        </div>
        {(place !== undefined || variety !== undefined) && (
          <div className="flex items-center gap-1 px-1">
            {place !== undefined && <VariantSwitch place={place} />}
            {variety !== undefined && <LiftButton variety={variety} className="ml-auto" />}
          </div>
        )}
        <p className="px-2.5 text-[13px] leading-[1.45] text-dt-muted max-sm:text-[15px]">
          {step.look}
        </p>
        {step.try !== undefined && (
          <p className="flex items-start gap-2 px-2.5 text-[13px] leading-[1.45] text-dt-text max-sm:text-[15px]">
            <MousePointerClick className="mt-0.5 size-3.5 shrink-0 text-dt-accent" aria-hidden />
            {step.try}
          </p>
        )}
      </section>
      <div
        ref={chat}
        className="flex min-h-0 flex-1 flex-col gap-2 border-t border-dt-line px-3 pt-2.5 pb-3 max-sm:flex-initial"
      >
        <div className="flex h-6 shrink-0 items-center gap-1.5 text-[11px] text-dt-muted max-sm:h-11 max-sm:text-[13px]">
          <Switch onPage={onPage} />
          {onPage && <span className="min-w-0 truncate">{placePath(pagePlace)}</span>}
        </div>
        {onPage ? (
          <StepChat
            key={pagePlace}
            step={pagePlace}
            placeholder="A message on this page"
            onTab={flip}
            fill
          />
        ) : (
          <StepChat key={step.id} step={step.id} onTab={flip} fill />
        )}
      </div>
    </>
  );
}

/** The page in the panel, off a step: the chat with the agent on this page, at the panel's
 * foot, where a step's chat is. A note pointed at an element goes with the next message. */
function PageView({ ruled }: { readonly ruled: boolean }) {
  const place = useSession((s) => s.context.place);
  return (
    <section
      aria-label="This page"
      className={cx(
        "flex max-h-[60%] min-h-0 shrink-0 flex-col gap-2 px-3 pt-2.5 pb-3 max-sm:max-h-none",
        ruled && "border-t border-dt-line",
      )}
    >
      <div className="flex h-6 shrink-0 items-center gap-1.5 text-[11px] text-dt-muted max-sm:text-[13px]">
        <span className="text-[12px] font-medium text-dt-text max-sm:text-[14px]">This page</span>
        <span className="min-w-0 truncate">{placePath(place)}</span>
      </div>
      <StepChat key={place} step={place} placeholder="A message on this page" />
    </section>
  );
}

/**
 * The chat with the agent on a step or a page: the thread, where it is with the agent, the
 * pointed notes that go with the next message, and the composer. With `fill`, the thread takes
 * the room above the composer, and its newest message stands just above it.
 */
export function StepChat({
  step,
  placeholder = "A message on this step",
  onTab,
  fill = false,
}: {
  readonly step: string;
  readonly placeholder?: string;
  readonly onTab?: ((insert: boolean) => void) | undefined;
  readonly fill?: boolean;
}) {
  const note = useStepNote(step);
  const pins = usePins(step);
  return (
    <>
      <div
        className={cx(
          "flex min-h-0 flex-col justify-end",
          fill ? "flex-1 max-sm:flex-initial" : "shrink",
        )}
      >
        <Thread note={note} className="min-h-0 max-sm:max-h-[35dvh]" />
      </div>
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

/** Whose chat the panel has on a step: the step's or the page's. A click or Tab switches. */
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
