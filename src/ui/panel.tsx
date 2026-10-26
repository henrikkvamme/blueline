import { ChevronDown, ChevronRight, PanelRightClose } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { placePath } from "../part/page";
import { stepNoteId, treeShown } from "../session/machine";
import { focusToWrite } from "../vim";
import { Chips, Composer, NoteState, Thread } from "./composer";
import { cx } from "./cx";
import { FinishView } from "./finish";
import { EMPTY_HINT, hintShows } from "./hint";
import { progressOf } from "./progress";
import { DOCK, FOCUSED, PANEL } from "./geometry";
import { MoreMenu } from "./more";
import { hasNews } from "../session/replies";
import { usePins, useSession, useStep, useStepNote, useTools } from "./session";
import { Foot, ICON, SettleButton, StepArrow, StepVariants } from "./step-controls";
import { usePhone } from "./touch";
import { TreeZone, useJourneys, useThisPage } from "./tree";

/*
 * The panel at the right: where the reviewer is, what to look at and try, and the chat with
 * the agent. Its top line holds the journey's title, which unfolds the tree, the journey's
 * progress as dots, More and Hide. On a step, the step fills the rest: its number and group,
 * its title and words, its variants, and its chat, with the message field and a foot of the
 * step arrows and Settle that stay in one place from step to step. Off a step, it shows the
 * tree and the page's chat. It docks: the page narrows by its width, so it covers nothing.
 * Hidden, the bar is its folded form. On a phone it is a sheet at the bottom.
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
  const { perform } = useTools();
  const shown = useSession((s) => s.context.panel && !s.context.preview);
  const active = useSession((s) => s.context.active);
  const tree = useSession((s) => s.context.tree);
  const finishing = useSession((s) => s.context.finish !== null);
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
      <div className="flex h-11 shrink-0 items-center gap-1 pr-1.5 pl-2 max-sm:h-14">
        {active || phone ? (
          <TreeLine unfolded={unfolded} />
        ) : (
          <span className="min-w-0 flex-1 truncate px-2 text-[13px] text-dt-muted">
            Pages and journeys
          </span>
        )}
        {active && <Progress finishing={finishing} />}
        <MoreMenu />
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
            {finishing ? <FinishView /> : <StepView />}
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

/** The tree folded to one line, at the panel's top: the journey's title on a step. A click
 * unfolds it, and so does a key of the tree's, as j, that comes while it has the keys. */
function TreeLine({ unfolded }: { readonly unfolded: boolean }) {
  const { actor } = useTools();
  const { journey } = useStep();
  const active = useSession((s) => s.context.active);
  const Icon = unfolded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      data-dt-zone="panel"
      aria-expanded={unfolded}
      aria-label={unfolded ? "Fold the pages and journeys" : "Pages and journeys"}
      onClick={() => actor.send({ type: "tree" })}
      className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-dt-control px-2 text-left text-[13px] text-dt-muted outline-none hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:text-[15px]"
    >
      <span className="min-w-0 truncate">
        {active && journey !== undefined ? journey.title : "Pages and journeys"}
      </span>
      <Icon className="size-3 shrink-0 text-dt-faint" aria-hidden />
    </button>
  );
}

/** The journey's progress, a dot for each step: green once settled, grey while open, and the
 * step shown a wider pill, blue while open. At the finish every dot is green and none is wider.
 * A journey with more steps than the dots fit shows a thin bar and the step's number instead,
 * in the same room (progress.ts). */
function Progress({ finishing }: { readonly finishing: boolean }) {
  const { journey, at } = useStep();
  const feedback = useSession((s) => s.context.feedback);
  const steps = journey?.steps ?? [];
  const settled = steps.filter((s) => feedback[s.id]?.settled === true).length;
  if (steps.length < 2) return null;
  const label = `${String(settled)} of ${String(steps.length)} steps settled`;
  const shape = progressOf(steps.length, settled, at, finishing);
  if (shape.look === "bar")
    return (
      <span role="img" aria-label={label} className="flex shrink-0 items-center gap-2 px-1.5">
        <span className="relative h-1 w-20 overflow-hidden rounded-full bg-dt-faint/35">
          <i
            className="absolute inset-y-0 left-0 rounded-full bg-dt-good transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${String(shape.settled * 100)}%` }}
          />
          {shape.place !== undefined && (
            <i
              className="absolute inset-y-0 min-w-1 rounded-full bg-dt-accent transition-[left] duration-200 ease-out motion-reduce:transition-none"
              style={{
                left: `${String(shape.place.from * 100)}%`,
                width: `${String(shape.place.width * 100)}%`,
              }}
            />
          )}
        </span>
        <span className="w-[8ch] text-right text-[12px] text-dt-faint tabular-nums">
          {shape.label}
        </span>
      </span>
    );
  return (
    <span
      role="img"
      aria-label={label}
      className="flex min-w-0 shrink items-center gap-[5px] overflow-hidden px-1.5"
    >
      {steps.map((s, i) => {
        const here = i === at && !finishing;
        return (
          <i
            key={s.id}
            className={cx(
              "h-1.5 shrink-0 rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none",
              here ? "w-4" : "w-1.5",
              feedback[s.id]?.settled === true
                ? "bg-dt-good"
                : here
                  ? "bg-dt-accent"
                  : "bg-dt-faint/35",
            )}
          />
        );
      })}
    </span>
  );
}

/** The step in the panel: its number and group, its title and words, its variants, and its
 * chat; at the foot, the message field and the step arrows round Settle. The chat is the
 * step's, or the page's, so the reviewer writes on the page and keeps their place in the
 * journey. */
function StepView() {
  const { actor } = useTools();
  const { journey, step, at } = useStep();
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
        <p className="px-4 pt-6 text-[14px] text-dt-muted">This page shows no part with variants</p>
        <PageView ruled={false} />
      </>
    );
  const group = step.group.title !== journey?.title ? step.group.title : undefined;
  return (
    <div ref={chat} className="flex min-h-0 flex-1 flex-col max-sm:flex-initial">
      <StepChat
        key={onPage ? pagePlace : step.id}
        step={onPage ? pagePlace : step.id}
        placeholder={onPage ? "A message on this page" : "A message on this step"}
        onTab={flip}
        head={
          <>
            <section
              aria-label={`Step ${String(at + 1)}: ${step.title}`}
              className="flex shrink-0 flex-col px-4 pt-6 max-sm:pt-2"
            >
              <span className="text-[12px] text-dt-faint tabular-nums">
                {at + 1}
                {group !== undefined && ` · ${group}`}
              </span>
              <h2 className="mt-1 text-[21px] leading-7 font-semibold tracking-[-0.01em] text-dt-text">
                {step.title}
              </h2>
              <p className="mt-2 text-[14px] leading-[1.55] text-dt-muted">{step.look}</p>
              {step.try !== undefined && (
                <p className="mt-2 text-[14px] leading-[1.55] text-dt-muted">{step.try}</p>
              )}
            </section>
            <StepVariants />
          </>
        }
        chatHead={<ChatSwitch onPage={onPage} />}
      />
      {/* Out of the chat's key, so the foot stays the same element from step to step. */}
      <Foot>
        <StepArrow by={-1} foot />
        <SettleButton foot />
        <StepArrow by={1} foot />
      </Foot>
    </div>
  );
}

/** Which chat the panel has on a step, at the chat's top: the step's, or the page's. It shows
 * only once the page's chat has messages, or while the panel has it; Tab in the message field
 * and the tree reach the page's chat too. */
function ChatSwitch({ onPage }: { readonly onPage: boolean }) {
  const { actor } = useTools();
  const place = useSession((s) => s.context.place);
  const pageChat = useStepNote(place);
  const count = pageChat?.thread.length ?? 0;
  if (!onPage && count === 0) return null;
  return (
    <div className="mb-auto flex h-7 shrink-0 items-center justify-between gap-2 text-[12px] max-sm:h-11">
      <span className="min-w-0 truncate text-dt-faint">
        {onPage ? `This page · ${placePath(place) ?? ""}` : "This step"}
      </span>
      <button
        type="button"
        onClick={() => actor.send({ type: "chat" })}
        className="-mr-2 flex h-7 shrink-0 items-center gap-1.5 rounded-dt-control px-2 text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:px-3 max-sm:text-[14px]"
      >
        {onPage ? (
          "Back to the step"
        ) : (
          <>
            The page&apos;s chat
            {pageChat !== undefined && hasNews(pageChat) ? (
              <span className="size-1.5 rounded-full bg-dt-accent" aria-label="New reply" />
            ) : (
              <span className="text-dt-faint tabular-nums">{count}</span>
            )}
          </>
        )}
      </button>
    </div>
  );
}

/** The page in the panel, off a step: the chat with the agent on this page, under the tree,
 * past one quiet line. The tree's row names the page, and the field's words name the chat.
 * A note pointed at an element goes with the next message. */
function PageView({ ruled }: { readonly ruled: boolean }) {
  const place = useSession((s) => s.context.place);
  // With no journey to walk and no part to review, one quiet line teaches Alt+click (hint.ts).
  const { journeys } = useJourneys();
  const { parts } = useThisPage();
  const messages = useStepNote(place)?.thread.length ?? 0;
  const notes = usePins(place).length;
  const hint = hintShows({ journeys: journeys.length, parts: parts.length, messages, notes });
  return (
    <section
      aria-label="This page"
      className={cx(
        "flex max-h-[60%] min-h-0 shrink-0 flex-col max-sm:max-h-none",
        ruled && "border-t border-dt-line",
      )}
    >
      <StepChat
        key={place}
        step={place}
        placeholder="A message on this page"
        fill={false}
        hint={hint ? EMPTY_HINT : undefined}
      />
    </section>
  );
}

/**
 * The chat with the agent on a step or a page: the thread, where it is with the agent, the
 * pointed notes that go with the next message, and the composer. With `fill`, the thread takes
 * the room left under `head`, and its newest message stands just above the composer; `head`
 * scrolls with it when the panel is short.
 */
export function StepChat({
  step,
  placeholder = "A message on this step",
  onTab,
  fill = true,
  head,
  chatHead,
  hint,
}: {
  readonly step: string;
  readonly placeholder?: string;
  readonly onTab?: ((insert: boolean) => void) | undefined;
  readonly fill?: boolean;
  readonly head?: ReactNode;
  readonly chatHead?: ReactNode;
  /** One quiet line in the empty chat, as how to start. */
  readonly hint?: string | undefined;
}) {
  const note = useStepNote(step);
  const pins = usePins(step);
  return (
    <>
      <div
        className={cx(
          "flex min-h-0 flex-col",
          fill ? "flex-1 overflow-y-auto overscroll-contain max-sm:flex-initial" : "shrink",
        )}
      >
        {head}
        <div
          className={cx(
            "flex min-h-0 flex-col justify-end gap-2 px-4 pt-4 max-sm:pt-2",
            fill ? "min-h-24 flex-1 max-sm:min-h-0 max-sm:flex-initial" : "shrink pt-2.5",
          )}
        >
          {chatHead}
          {hint !== undefined && (
            // A phone has no Alt: its message field's pin points at an element.
            <p className="text-[13px] text-dt-faint max-sm:hidden">{hint}</p>
          )}
          <Thread note={note} className="min-h-0 max-sm:max-h-[35dvh]" />
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3">
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
      </div>
    </>
  );
}
