import {
  Check,
  CircleQuestionMark,
  Eye,
  EyeOff,
  Layers,
  MessageSquare,
  PanelRight,
} from "lucide-react";
import { isKept } from "../notes/note";
import { hasNews } from "../session/replies";
import { cx } from "./cx";
import { DOCK } from "./geometry";
import { useNotes, useSession, useStep, useTools } from "./session";
import { SettleButton, StepArrow, StepTrouble, useVariety } from "./step-controls";

/*
 * The bar at the bottom centre: the panel's folded form, which shows only while the panel is
 * hidden. On a step it is full: the step's number and title, the step before and after, and
 * Settle. Off a review the tools are idle, and keep out of the app's way: only a small, faint
 * launcher in the corner shows the panel, with a dot for replies not read. The
 * preview hides the rest of the tools, and leaves only an eye that shows them again, so the
 * page shows the tools are on. Each bar has a `?` for the keys and commands, which also does
 * what each one does. On a phone the full bar takes the screen's width, above the page's own
 * bottom bar, and its buttons are 44 px, for a finger.
 */

/** A tool's button at the bar's end. */
const TOOL =
  "grid size-7 shrink-0 place-items-center text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:size-11";

/** The bar comes in once the panel has gone, so the two never show at once. */
const ARRIVE = "transition-opacity delay-200 duration-150 starting:opacity-0";

export function Bar() {
  const { perform } = useTools();
  const active = useSession((s) => s.context.active);
  const panel = useSession((s) => s.context.panel);
  const lift = useVariety();
  const variety = lift === undefined ? undefined : `${String(lift.count)} ${lift.kind}`;
  const { journey, at } = useStep();
  const notes = useNotes();
  const answered = notes.filter(hasNews).length;
  const feedback = useSession((s) => s.context.feedback);
  const pagePlace = useSession((s) => s.context.place);
  const preview = useSession((s) => s.context.preview);
  const trouble = useSession((s) => s.context.trouble);
  const ids = journey?.steps.map((s) => s.id) ?? [];
  // A step of the journey names a part, or has states of its own, for v to lift.
  const lifts = journey?.steps.some((s) => s.part !== undefined || (s.variants?.length ?? 0) > 1);
  // The steps settled of all, as the tree counts them; a check when every one is.
  const settled = ids.filter((id) => feedback[id]?.settled === true).length;
  // The notes on this page that wait for the next message, and the replies not read.
  const here = notes.filter((n) => n.step === pagePlace);
  const drafts = here.filter(isKept).length;
  const news = here.filter(hasNews).length;
  if (preview)
    return (
      <Small>
        <PreviewEye
          count={
            active ? (
              <span className="flex items-center gap-1 tabular-nums">
                {ids.length > 0 && settled === ids.length && (
                  <Check className="size-3.5 text-dt-good" aria-label="Every step settled" />
                )}
                {settled}/{ids.length}
              </span>
            ) : (
              drafts > 0 && <span className="text-dt-warn tabular-nums">{drafts}</span>
            )
          }
          news={active ? answered : news}
        />
      </Small>
    );
  // The panel shows: it has all the bar has.
  if (panel) return null;
  if (!active) return <Launcher drafts={drafts} news={answered} />;
  return (
    <div
      {...DOCK}
      role="toolbar"
      aria-label="Review"
      className={cx(
        "fixed bottom-3 left-1/2 z-[2147483002] flex -translate-x-1/2 items-center gap-0.5 rounded-dt-panel bg-dt-panel p-1 text-dt-text shadow-dt-float max-sm:inset-x-2 max-sm:bottom-(--dt-base) max-sm:translate-x-0",
        ARRIVE,
      )}
    >
      <StepArrow by={-1} />
      {/* As wide as the journey's longest title, so the bar keeps its size and place from step
          to step, and has no room left over on a journey of short ones. */}
      <span className="flex max-w-72 min-w-0 items-baseline gap-1.5 px-1 text-[13px] max-sm:max-w-none max-sm:flex-1 max-sm:text-[14px]">
        {ids.length === 0 ? (
          <span className="truncate text-dt-muted">This page shows no part with variants</span>
        ) : (
          <>
            <span className="w-4 shrink-0 text-right text-[12px] text-dt-faint tabular-nums">
              {at + 1}
            </span>
            <span className="grid min-w-0">
              {journey?.steps.map((s, i) => (
                <span
                  key={s.id}
                  aria-hidden={i !== at}
                  // A phone's bar has room for two short lines in its height.
                  className={cx(
                    "col-start-1 row-start-1 truncate max-sm:line-clamp-2 max-sm:leading-[18px] max-sm:whitespace-normal",
                    i !== at && "invisible",
                  )}
                >
                  {s.title}
                </span>
              ))}
            </span>
            <StepTrouble reason={trouble[journey?.steps[at]?.id ?? ""]} />
          </>
        )}
      </span>
      <StepArrow by={1} />
      {/* A fixed place, so the bar keeps its size on a step with nothing to lift, on a journey
          with a step that has. A phone keeps the room for the title: the panel, v and the `?`
          menu lift the part. */}
      {(variety !== undefined || lifts === true) && (
        <button
          type="button"
          aria-label={variety === undefined ? undefined : `Lift the part: ${variety}`}
          aria-hidden={variety === undefined}
          tabIndex={variety === undefined ? -1 : undefined}
          className={cx(
            "flex h-8 w-32 shrink-0 items-center gap-1.5 rounded-dt-control px-2 text-[12px] whitespace-nowrap text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:hidden",
            variety === undefined && "invisible",
          )}
          onClick={() => perform({ kind: "lift" })}
        >
          <Layers className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 text-left">{variety}</span>
        </button>
      )}
      {ids.length > 0 && <SettleButton compact wide={lifts === true} />}
      <span className="mx-1 h-5 w-px shrink-0 bg-dt-line max-sm:mx-0.5" />
      {/* A phone has no room for it in the bar: the `?` menu hides the tools too. */}
      <button
        type="button"
        aria-label="Hide the tools"
        title="Hide the tools to see the page as a user does"
        className={cx(TOOL, "rounded-dt-control max-sm:hidden")}
        onClick={() => perform({ kind: "event", event: { type: "preview" } })}
      >
        <EyeOff className="size-4" aria-hidden />
      </button>
      <HelpButton shape="rounded-dt-control" />
      <PanelButton news={answered} shape="rounded-dt-control" />
    </div>
  );
}

/** In the preview, the one control left: it shows the tools again. */
function PreviewEye({ count, news }: { readonly count: React.ReactNode; readonly news: number }) {
  const { perform } = useTools();
  const answered = useNotes().filter(hasNews).length;
  return (
    <button
      type="button"
      aria-label={answered > 0 ? `Show the tools, ${answered} new replies` : "Show the tools"}
      onClick={() => perform({ kind: "event", event: { type: "preview" } })}
      className="flex h-7 items-center gap-1.5 rounded-full px-2.5 hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:px-4"
    >
      <Eye className="size-3.5 max-sm:size-4" aria-hidden />
      {count}
      {news > 0 && <News count={news} />}
    </button>
  );
}

/** While the tools are idle, the one thing they show: a faint button in the corner that shows
 * the panel, to start a review or read the page's chat. It is clear only on hover, or with a
 * reply not read or an annotation that waits for the next message. */
function Launcher({ drafts, news }: { readonly drafts: number; readonly news: number }) {
  const { perform } = useTools();
  const label =
    news > 0
      ? `Blueline: ${String(news)} new replies`
      : drafts > 0
        ? `Blueline: ${String(drafts)} annotations not sent`
        : "Blueline";
  return (
    <button
      {...DOCK}
      type="button"
      aria-label={label}
      title={`${label}. Show the panel to start a review (Ctrl+B); Alt+click annotates the page.`}
      onClick={() => perform({ kind: "panel" })}
      className={cx(
        "fixed right-3 bottom-3 z-[2147483002] grid size-7 place-items-center rounded-full bg-dt-panel text-dt-muted shadow-dt-float transition-opacity hover:text-dt-text hover:opacity-100 focus-visible:opacity-100 max-sm:bottom-(--dt-base) max-sm:size-11",
        news > 0 || drafts > 0 ? "opacity-90" : "opacity-35",
        ARRIVE,
      )}
    >
      <MessageSquare className="size-3.5 max-sm:size-4" aria-hidden />
      {(news > 0 || drafts > 0) && (
        <span
          aria-hidden
          className={cx(
            "absolute top-0 right-0 size-2 rounded-full",
            news > 0 ? "bg-dt-accent" : "bg-dt-warn",
          )}
        />
      )}
    </button>
  );
}

/** Shows the panel again, as Ctrl+B does, with the count of replies not read. */
function PanelButton({ news, shape }: { readonly news: number; readonly shape: string }) {
  const { perform } = useTools();
  return (
    <button
      type="button"
      aria-label={news > 0 ? `Show the panel, ${news} new replies` : "Show the panel"}
      title="Show the panel"
      className={cx("relative", TOOL, shape)}
      onClick={() => perform({ kind: "panel" })}
    >
      <PanelRight className="size-4" aria-hidden />
      {news > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid min-w-3.5 place-items-center rounded-full bg-dt-bad px-0.5 text-[9px] leading-3.5 font-semibold text-white">
          {news}
        </span>
      )}
    </button>
  );
}

/** Opens the keys and commands: every key, each of which a click or a tap does, and the app's
 * commands. */
function HelpButton({ shape }: { readonly shape: string }) {
  const { perform } = useTools();
  return (
    <button
      type="button"
      aria-label="Keys and commands"
      title="Keys and commands"
      className={cx(TOOL, shape)}
      onClick={() => perform({ kind: "event", event: { type: "open", layer: "help" } })}
    >
      <CircleQuestionMark className="size-4" aria-hidden />
    </button>
  );
}

/** The small bar: in the full bar's place, at the bottom centre. */
function Small({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      {...DOCK}
      role="toolbar"
      aria-label="Blueline"
      className={cx(
        "fixed bottom-3 left-1/2 z-[2147483002] flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-dt-panel p-0.5 text-[12px] text-dt-muted shadow-dt-float max-sm:bottom-(--dt-base) max-sm:p-1",
        ARRIVE,
      )}
    >
      {children}
    </div>
  );
}

function News({ count }: { readonly count: number }) {
  return (
    <span className="rounded-full bg-dt-accent px-1.5 text-[10px] font-semibold text-white tabular-nums">
      {count}
    </span>
  );
}
