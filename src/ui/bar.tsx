import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleQuestionMark,
  Eye,
  EyeOff,
  Layers,
  MessageSquare,
  PanelRight,
} from "lucide-react";
import { isKept } from "../notes/note";
import { useSyncExternalStore } from "react";
import { NO_VERDICTS, partOn, parts, variantOf, varietyOf } from "../part/store";
import { hasNews } from "../session/replies";
import { cx } from "./cx";
import { DOCK } from "./geometry";
import { useNotes, useSession, useStep, useTools, useVariant } from "./session";

/*
 * The bar at the bottom centre, in two sizes. On a step it is full: where the walk is, and
 * the steps with their replies. Off a step it is small in the same place: the page's chat
 * and the sidebar. The preview hides the rest of the tools, and leaves only an eye that
 * shows them again, so the page shows the tools are on. Each bar has a `?` for the keys and
 * commands, which also does what each one does. On a phone the full bar takes the screen's
 * width, above the page's own bottom bar, and its buttons are 44 px, for a finger.
 */

/** What the step has to lift with v: how many of its part's variants or states, or of the
 * step's own states, which its `variants` set up on the page; none when it has nothing. */
function useVariety():
  | { readonly count: number; readonly kind: "variants" | "states" }
  | undefined {
  const { journey, step } = useStep();
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  if (step === undefined) return undefined;
  const part = partOn(step, journey);
  const variety =
    part === undefined ? undefined : varietyOf(part, now.verdicts[part.name] ?? NO_VERDICTS);
  if (variety !== undefined)
    return variety.variants > 1
      ? { count: variety.variants, kind: "variants" }
      : { count: variety.states + 1, kind: "states" };
  const own = step.variants?.length ?? 0;
  return own > 1 ? { count: own, kind: "states" } : undefined;
}

/** Which variant the step shows, of how many: its part's variants, else the step's own. */
export function useVariantPlace():
  | { readonly at: number; readonly of: number; readonly label: string }
  | undefined {
  const { journey, step } = useStep();
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  const own = useVariant(step);
  if (step === undefined) return undefined;
  const part = partOn(step, journey);
  if (part !== undefined) {
    const verdicts = now.verdicts[part.name] ?? NO_VERDICTS;
    const left = part.labels.filter((l) => !verdicts.dropped.includes(l));
    if (left.length > 1) {
      const label = variantOf(
        part.labels,
        now.shown[part.name] ?? parts.shown(part.name),
        verdicts,
      );
      return { at: left.indexOf(label), of: left.length, label };
    }
  }
  return own !== undefined && own.count > 1
    ? { at: own.index, of: own.count, label: own.label }
    : undefined;
}

const button =
  "grid size-8 shrink-0 place-items-center rounded-dt-control text-dt-muted hover:bg-dt-raised hover:text-dt-text disabled:opacity-40 max-sm:size-11";

/** A tool's button at the bar's end, as the sidebar's. */
const TOOL =
  "grid size-7 shrink-0 place-items-center text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:size-11";

export function Bar() {
  const { actor, perform } = useTools();
  const active = useSession((s) => s.context.active);
  const lift = useVariety();
  const variety = lift === undefined ? undefined : `${String(lift.count)} ${lift.kind}`;
  const { journey, at } = useStep();
  const notes = useNotes();
  const answered = notes.filter(hasNews).length;
  const feedback = useSession((s) => s.context.feedback);
  const pagePlace = useSession((s) => s.context.place);
  const preview = useSession((s) => s.context.preview);
  const ids = journey?.steps.map((s) => s.id) ?? [];
  // A step of the journey names a part, or has states of its own, for v to lift.
  const lifts = journey?.steps.some((s) => s.part !== undefined || (s.variants?.length ?? 0) > 1);
  // The steps settled of all, as the sidebar counts them; a check when every one is.
  const settled = ids.filter((id) => feedback[id]?.settled === true).length;
  const count = (
    <span className="flex items-center gap-1 tabular-nums">
      {ids.length > 0 && settled === ids.length && (
        <Check className="size-3.5 text-dt-good" aria-label="Every step settled" />
      )}
      {settled}/{ids.length}
    </span>
  );
  // The notes on this page that wait for the next message, and the replies not read.
  const here = notes.filter((n) => n.step === pagePlace);
  const drafts = here.filter(isKept).length;
  const news = here.filter(hasNews).length;
  if (preview)
    return (
      <Small>
        <button
          type="button"
          aria-label={answered > 0 ? `Show the tools, ${answered} new replies` : "Show the tools"}
          onClick={() => actor.send({ type: "preview" })}
          className="flex h-7 items-center gap-1.5 rounded-full px-2.5 hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:px-4"
        >
          <Eye className="size-3.5 max-sm:size-4" aria-hidden />
          {active
            ? count
            : drafts > 0 && <span className="text-dt-warn tabular-nums">{drafts}</span>}
          {(active ? answered : news) > 0 && <News count={active ? answered : news} />}
        </button>
      </Small>
    );
  if (!active)
    return (
      <Small>
        <PageChat drafts={drafts} news={news} />
        <HelpButton shape="rounded-full" />
        <SidebarButton news={0} shape="rounded-full" />
      </Small>
    );
  // The arrows go to every step, settled too, as h and l do.
  const back = Math.max(at - 1, 0);
  const on = Math.min(at + 1, Math.max(ids.length - 1, 0));
  return (
    <div
      {...DOCK}
      role="toolbar"
      aria-label="Review"
      className="fixed bottom-3 left-1/2 z-[2147483002] flex -translate-x-1/2 items-center gap-0.5 rounded-dt-panel bg-dt-panel p-1 text-dt-text shadow-dt-float max-sm:inset-x-2 max-sm:bottom-(--dt-base) max-sm:translate-x-0"
    >
      <button
        type="button"
        aria-label="Step before"
        disabled={back === at}
        className={button}
        onClick={() => actor.send({ type: "go", by: -1 })}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      {/* As wide as the journey's longest title, so the bar keeps its size and place from step
          to step, and has no room left over on a journey of short ones. */}
      <span className="flex max-w-72 min-w-0 items-baseline gap-2 px-1.5 text-[13px] max-sm:max-w-none max-sm:flex-1 max-sm:px-1 max-sm:text-[14px]">
        {ids.length === 0 ? (
          <span className="truncate text-dt-muted">This page shows no part with variants</span>
        ) : (
          <>
            <span
              className="shrink-0 text-dt-faint"
              title={`${String(settled)} of ${String(ids.length)} steps settled; this is step ${String(at + 1)}`}
            >
              {count}
            </span>
            <span className="grid min-w-0">
              {journey?.steps.map((s, i) => (
                <span
                  key={s.id}
                  aria-hidden={i !== at}
                  className={cx("col-start-1 row-start-1 truncate", i !== at && "invisible")}
                >
                  {s.title}
                </span>
              ))}
            </span>
          </>
        )}
      </span>
      <button
        type="button"
        aria-label="Step after"
        disabled={on === at}
        className={button}
        onClick={() => actor.send({ type: "go", by: 1 })}
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
      {/* A fixed place, so the bar keeps its size on a step with nothing to lift, on a journey
          with a step that has. */}
      {(variety !== undefined || lifts === true) && (
        <button
          type="button"
          aria-label={variety === undefined ? undefined : `Lift the part: ${variety}`}
          aria-hidden={variety === undefined}
          tabIndex={variety === undefined ? -1 : undefined}
          className={cx(
            "flex h-8 w-32 shrink-0 items-center gap-1.5 rounded-dt-control px-2 text-[12px] whitespace-nowrap text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:w-auto max-sm:px-2.5 max-sm:text-[14px]",
            variety === undefined && "invisible",
          )}
          onClick={() => perform({ kind: "lift" })}
        >
          <Layers className="size-4 shrink-0" aria-hidden />
          {/* A phone has room for the count alone. */}
          <span className="flex-1 text-left max-sm:hidden">{variety}</span>
          <span className="tabular-nums sm:hidden">{lift?.count}</span>
        </button>
      )}
      <span className="mx-1 h-5 w-px shrink-0 bg-dt-line max-sm:mx-0.5" />
      <button
        type="button"
        aria-label="Hide the tools"
        title="Hide the tools to see the page as a user does"
        className={cx(TOOL, "rounded-dt-control")}
        onClick={() => perform({ kind: "event", event: { type: "preview" } })}
      >
        <EyeOff className="size-4" aria-hidden />
      </button>
      <HelpButton shape="rounded-dt-control" />
      <SidebarButton news={answered} shape="rounded-dt-control" />
    </div>
  );
}

/** Opens the page's card, to write on the page, with the notes not sent and the replies not
 * read. */
function PageChat({ drafts, news }: { readonly drafts: number; readonly news: number }) {
  const { perform } = useTools();
  return (
    <button
      type="button"
      aria-label={drafts > 0 ? `This page, ${String(drafts)} not sent` : "This page"}
      onClick={() => perform({ kind: "focus", to: "note" })}
      className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-dt-text hover:bg-dt-raised max-sm:h-11 max-sm:px-4 max-sm:text-[14px]"
    >
      <MessageSquare className="size-3.5 text-dt-accent" aria-hidden />
      This page
      {drafts > 0 && <span className="text-dt-warn tabular-nums">{drafts}</span>}
      {news > 0 && <News count={news} />}
    </button>
  );
}

/** Shows or hides the sidebar, with the count of replies not read. */
function SidebarButton({ news, shape }: { readonly news: number; readonly shape: string }) {
  const { actor } = useTools();
  return (
    <button
      type="button"
      aria-label={news > 0 ? `Sidebar, ${news} new replies` : "Sidebar"}
      className={cx("relative", TOOL, shape)}
      onClick={() => actor.send({ type: "sidebar" })}
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
      className="fixed bottom-3 left-1/2 z-[2147483002] flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-dt-panel p-0.5 text-[12px] text-dt-muted shadow-dt-float max-sm:bottom-(--dt-base) max-sm:p-1"
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
