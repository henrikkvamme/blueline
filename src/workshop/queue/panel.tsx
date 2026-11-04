import {
  ArrowLeft,
  Pause,
  Play,
  Volume2,
  VolumeX,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CornerDownRight,
  Eye,
  GitMerge,
  ChevronDown,
  Mic,
  PenLine,
  RotateCcw,
  Shuffle,
  ThumbsDown,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ahead,
  annotationsOn,
  answerOf,
  current,
  done,
  isSettled,
  remarkOf,
  left,
  order,
  isTried,
  waiting,
  type Kind,
  type Moment,
  type Queue,
  type Remark,
} from "../../queue/queue";
import { cx } from "../../ui/cx";
import { AgentMark } from "./mark";
import { PANEL } from "../../ui/geometry";
import { JOURNEY, PAGES, TARGETS, changeOf, targetOf } from "./script";
import type { Phase } from "./walker";

/*
 * The panel of the queue prototype: the remark that shows, what waits on the agent, what
 * comes next, and Back and Next. It draws only from its props, so the states page draws each
 * state from a queue.
 */

export interface Composer {
  readonly target: string;
  readonly text: string;
  /** What showed when he opened it. */
  readonly moment?: Moment | undefined;
}

export interface Ship {
  /** Seconds until the merge, or "shipped". */
  readonly in: number | "shipped";
}

/** How long the agent waits after the last settle before it ships. */
export const SHIP_SECONDS = 10;

/** The line between him and the agent, at the panel's foot. */
export interface Line {
  /** What the agent heard him say; none while it listens or hears. */
  readonly said: string | undefined;
  /** What a fast model heard him ask for, a second after he spoke, before the agent answers.
   * It grows as its words come. */
  readonly heard?: string | undefined;
  readonly tone: "listening" | "busy" | "showing" | "done" | "failed";
  /** What the agent does now, or its last words. */
  readonly status: string;
  /** Where its walk is, while it shows him. */
  readonly beat?: { readonly at: number; readonly of: number } | undefined;
  /** The change it put in the queue: when it comes back, or that it came. */
  readonly change?: string | undefined;
  /** Shows the agent's last walk again. */
  readonly onAgain?: (() => void) | undefined;
  /** Says the answer was wrong and why: it becomes an eval case. */
  readonly wrong?: Wrong | undefined;
}

export interface Wrong {
  readonly state: "idle" | "asking" | "saving" | "saved" | "failed";
  readonly onOpen: () => void;
  readonly onSend: (reason: string) => void;
  readonly onClose: () => void;
}

export interface PanelProps {
  readonly queue: Queue;
  /** Seconds until the agent's next answer comes. */
  readonly eta: number | undefined;
  readonly composer: Composer | undefined;
  readonly toast: readonly string[];
  readonly leftOpen?: string | undefined;
  readonly onSettleOpen?: () => void;
  /** Point and talk: what he said last, and how far the agent's answer is. */
  readonly exchange?: Line | undefined;
  readonly ship: Ship | undefined;
  /** Draws one variant of a choice, small, in the app's own look. */
  readonly preview?: (remark: Remark, variant: string, state: string | undefined) => ReactNode;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onAnnotate: () => void;
  readonly onWrite: (text: string) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onPick: (value: string) => void;
  readonly onUndo: () => void;
  readonly onStop: () => void;
  /** Show one remark: from the bar, or from Seen. */
  readonly onShow?: (id: string) => void;
  readonly tree?: boolean;
  readonly onTree?: (open: boolean) => void;
  /** The choice that shows on the page and is not kept. */
  readonly peek?: string | undefined;
  readonly onPeek?: (value: string | undefined) => void;
  /** The state that a choice's part shows, of its states; none for the page's own. */
  readonly state?: string | undefined;
  readonly onState?: (state: string | undefined) => void;
  /** Where the agent's cursor is on this remark's walk; none when it has no walk. */
  readonly walk?: Phase | undefined;
  /** An answer: whether the page shows the element as it was, and to show it so. */
  readonly before?: boolean;
  readonly onBefore?: (on: boolean) => void;
  /** The beat that the walk shows, from 0, and how many it has. */
  readonly beat?: { readonly at: number; readonly of: number } | undefined;
  /** Pause the walk, go on with it, or walk again. */
  readonly onWalk?: () => void;
  readonly voice?: boolean;
  readonly onVoice?: () => void;
  /** Docked at the page's right edge, as the real panel is, or in the flow of the states
   * page. */
  readonly docked?: boolean;
}

const KIND: Readonly<Record<Kind, { readonly label: string; readonly Icon: typeof Eye }>> = {
  look: { label: "Look", Icon: Eye },
  answer: { label: "Answer", Icon: CornerDownRight },
  choice: { label: "Choose", Icon: Shuffle },
  question: { label: "Question", Icon: CircleHelp },
};

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

const pageTitle = (path: string) => PAGES.find((p) => p.path === path)?.title ?? path;

const button =
  "flex h-8 items-center gap-1.5 rounded-dt-control px-2.5 text-[13px] font-medium transition-colors disabled:opacity-35";
const ghost = `${button} text-dt-muted enabled:hover:bg-dt-raised enabled:hover:text-dt-text`;
const primary = `${button} bg-dt-accent pr-2 pl-3 text-white enabled:hover:brightness-110`;

interface Gone {
  readonly remark: Remark;
  readonly settled: boolean;
  readonly back: boolean;
}

export function Panel(props: PanelProps) {
  const { queue: q } = props;
  const here = current(q);
  const [shownAt, setShownAt] = useState({ id: here?.id, at: q.at });
  const [gone, setGone] = useState<Gone | undefined>(undefined);
  if (shownAt.id !== here?.id) {
    setShownAt({ id: here?.id, at: q.at });
    const was = remarkOf(q, shownAt.id);
    setGone(
      was === undefined || here === undefined
        ? undefined
        : { remark: was, settled: props.toast.includes(was.id), back: q.at < shownAt.at },
    );
  }
  const forward = ahead(q).some((item) => item.kind === "remark");
  const shipping = done(q) && props.ship !== undefined;
  return (
    <aside
      aria-label="Blueline"
      style={{ width: PANEL }}
      className={cx(
        "blueline flex flex-col bg-dt-panel text-dt-text",
        props.docked === true
          ? "fixed inset-y-0 right-0 z-[2147483002] border-l border-dt-line"
          : "relative h-full overflow-hidden rounded-dt-panel shadow-dt-float",
      )}
    >
      <Header {...props} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {shipping ? (
          <Shipping ship={props.ship} onStop={props.onStop} />
        ) : props.tree === true ? (
          <Tree
            queue={q}
            onShow={(id) => props.onShow?.(id)}
            active={here === undefined ? undefined : <RemarkView {...props} remark={here} inline />}
          />
        ) : here === undefined ? (
          <Idle queue={q} eta={props.eta} />
        ) : (
          <div
            key={here.id}
            className={cx(
              gone !== undefined &&
                (gone.back ? "motion-safe:animate-dt-in-back" : "motion-safe:animate-dt-in-next"),
              gone?.settled === true && "[animation-delay:300ms]",
            )}
          >
            <RemarkView {...props} remark={here} />
          </div>
        )}
        {gone !== undefined && here !== undefined && !shipping && props.tree !== true && (
          <div
            key={`${gone.remark.id}-gone`}
            aria-hidden
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) setGone(undefined);
            }}
            className={cx(
              "pointer-events-none absolute inset-x-0 top-0 bg-dt-panel motion-reduce:hidden",
              gone.settled
                ? "animate-dt-settled"
                : gone.back
                  ? "animate-dt-out-back"
                  : "animate-dt-out-next",
            )}
          >
            <RemarkView
              {...props}
              walk={undefined}
              peek={undefined}
              state={undefined}
              remark={gone.remark}
            />
            {gone.settled && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-12 animate-dt-stamp place-items-center rounded-full bg-dt-good text-dt-ground shadow-dt-float">
                  <Check className="size-6" strokeWidth={3} aria-hidden />
                </span>
              </span>
            )}
          </div>
        )}
      </div>
      {props.composer === undefined &&
        (props.toast.length > 0 ? (
          <Toast count={props.toast.length} onUndo={props.onUndo} />
        ) : props.leftOpen !== undefined ? (
          <LeftOpen onSettle={props.onSettleOpen} />
        ) : props.exchange !== undefined ? (
          <ExchangeLine line={props.exchange} />
        ) : (
          !shipping && here !== undefined && <UpNext queue={q} eta={props.eta} forward={forward} />
        ))}
      {props.composer !== undefined ? (
        <ComposerView {...props} composer={props.composer} />
      ) : (
        <footer className="flex h-13 shrink-0 items-center gap-1 border-t border-dt-line px-2.5">
          <button
            type="button"
            className={ghost}
            disabled={here === undefined || shipping}
            onClick={props.onAnnotate}
          >
            <PenLine className="size-3.5" aria-hidden />
            Annotate
          </button>
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Back"
            className={cx(ghost, "w-8 justify-center px-0")}
            disabled={q.at <= 0}
            onClick={props.onBack}
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={primary}
            disabled={!forward && here === undefined}
            onClick={props.onNext}
          >
            Next
            <ArrowRight className="size-4" aria-hidden />
          </button>
        </footer>
      )}
    </aside>
  );
}

/** The journey, how much is left, and the queue as a bar: the remark that shows, then what
 * Next takes, in its order. A settled remark leaves the bar; an annotation with the agent
 * holds the place where its answer comes, and pulses until it does. A click on a remark in
 * the bar shows it. The remarks seen before are in Seen. */
function Header(props: PanelProps) {
  const { queue: q, eta } = props;
  const count = left(q);
  const [help, setHelp] = useState(false);
  const here = current(q);
  const queue = ahead(q);
  const wait = waiting(q).length;
  const tab =
    "grid h-6 place-items-center rounded-full text-[12px] text-dt-faint hover:bg-dt-raised hover:text-dt-text aria-expanded:bg-dt-raised aria-expanded:text-dt-text";
  return (
    <header className="relative flex shrink-0 flex-col gap-2.5 px-4 pt-3.5 pb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={props.tree === true}
          onClick={() => props.onTree?.(props.tree !== true)}
          className="-ml-1.5 flex min-w-0 flex-1 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-left text-[13px] font-medium hover:bg-dt-raised"
        >
          <span className="truncate">{JOURNEY}</span>
          <ChevronDown
            aria-hidden
            className={cx(
              "size-3.5 shrink-0 text-dt-faint transition-transform duration-200",
              props.tree === true && "rotate-180",
            )}
          />
        </button>
        <span className="text-[12px] text-dt-faint tabular-nums">
          {count === 0 ? "Nothing left" : `${String(count)} left`}
        </span>
        <span className="-mr-1.5 flex items-center">
          <button
            type="button"
            aria-label="Keys"
            aria-expanded={help}
            onClick={() => setHelp((h) => !h)}
            className={cx(tab, "size-6")}
          >
            ?
          </button>
        </span>
      </div>
      <div className="flex h-1 items-center gap-[3px]">
        {here !== undefined && (
          <span
            aria-hidden
            className={cx(
              "h-full flex-[2.2] rounded-full transition-all duration-300 ease-out",
              isSettled(q, here.id)
                ? "bg-dt-good"
                : here.kind === "answer"
                  ? "bg-dt-good"
                  : "bg-dt-accent",
            )}
          />
        )}
        {queue.map((item) =>
          item.kind === "remark" ? (
            <button
              key={item.remark.id}
              type="button"
              aria-label={item.remark.title}
              title={item.remark.title}
              onClick={() => props.onShow?.(item.remark.id)}
              // A taller hit area than the bar it draws.
              className="group -my-1.5 flex h-4 flex-1 animate-dt-fade items-center"
            >
              <span
                className={cx(
                  "h-1 w-full rounded-full transition-colors duration-150 group-hover:bg-dt-muted",
                  item.remark.kind === "answer" ? "bg-dt-good/45" : "bg-dt-raised",
                )}
              />
            </button>
          ) : (
            <span
              key={item.annotation.id}
              title="The agent's answer to your annotation"
              className="h-full flex-1 animate-pulse rounded-full bg-dt-accent/45"
            />
          ),
        )}
      </div>
      {wait > 0 && <Agent count={wait} eta={eta} />}
      {help && <Keys />}
    </header>
  );
}

type RowMark = "here" | "settled" | "agent" | "untried" | "open";

const markOf = (q: Queue, r: Remark): RowMark =>
  current(q)?.id === r.id
    ? "here"
    : isSettled(q, r.id)
      ? "settled"
      : annotationsOn(q, r.id).some((a) => answerOf(q, a.id) === undefined)
        ? "agent"
        : q.trail.includes(r.id) && !isTried(q, r)
          ? "untried"
          : "open";

function RowMarkView({ mark }: { readonly mark: RowMark }) {
  switch (mark) {
    case "here":
      return <span className="size-2 rounded-full bg-dt-accent ring-4 ring-dt-accent/20" />;
    case "settled":
      return (
        <span className="grid size-4 place-items-center rounded-full bg-dt-good/15 text-dt-good">
          <Check className="size-2.5" strokeWidth={3} aria-label="Settled" />
        </span>
      );
    case "agent":
      return <AgentMark className="size-3.5 animate-pulse" />;
    case "untried":
      return (
        <span
          title="Passed, still open"
          className="size-3 rounded-full border-[1.5px] border-dashed border-dt-warn"
        />
      );
    case "open":
      return <span className="size-3 rounded-full border-[1.5px] border-dt-faint/70" />;
  }
}

function Tree({
  queue: q,
  onShow,
  active,
}: {
  readonly queue: Queue;
  readonly onShow: (id: string) => void;
  readonly active: ReactNode;
}) {
  const here = current(q)?.id;
  const ids = [
    ...q.settled,
    ...q.trail,
    ...order(q).map((r) => r.id),
    ...q.remarks.map((r) => r.id),
  ];
  const ranked = [...new Set(ids)]
    .map((id) => remarkOf(q, id))
    .filter((r): r is Remark => r !== undefined);
  const groups = PAGES.map((page) => ({
    page,
    remarks: ranked.filter((r) => r.page === page.path),
  })).filter((g) => g.remarks.length > 0);
  const [folded, setFolded] = useState<readonly string[]>([]);
  const shownOf = (g: (typeof groups)[number]) =>
    folded.includes(g.page.path) ? g.remarks.filter((r) => r.id === here) : g.remarks;
  return (
    <nav aria-label="Remarks" className="flex animate-dt-arrive flex-col gap-1 px-2.5 pt-1 pb-5">
      {groups.map(({ page, remarks }) => {
        const open = !folded.includes(page.path);
        const done = remarks.filter((r) => isSettled(q, r.id)).length;
        return (
          <section key={page.path} className="flex flex-col">
            <button
              type="button"
              aria-expanded={open}
              onClick={() =>
                setFolded((f) =>
                  open ? [...f, page.path] : f.filter((path) => path !== page.path),
                )
              }
              className="flex h-8 items-center gap-1.5 rounded-[8px] px-1.5 text-[12px] font-medium text-dt-faint hover:text-dt-text"
            >
              <ChevronRight
                aria-hidden
                className={cx("size-3.5 transition-transform duration-200", open && "rotate-90")}
              />
              <span className="flex-1 text-left">{page.title}</span>
              <span className="tabular-nums">
                {done}/{remarks.length}
              </span>
            </button>
            {shownOf({ page, remarks }).length > 0 && (
              <ul className="relative ml-[13px] flex flex-col border-l border-dt-line pl-1.5">
                {shownOf({ page, remarks }).map((r) => {
                  const mark = markOf(q, r);
                  const kind = KIND[r.kind];
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onShow(r.id)}
                        aria-current={r.id === here ? "true" : undefined}
                        className={cx(
                          "flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-left text-[13px] transition-colors hover:bg-dt-raised",
                          r.id === here && "bg-dt-raised",
                          mark === "here"
                            ? "font-medium text-dt-text"
                            : mark === "settled"
                              ? "text-dt-faint"
                              : "text-dt-muted",
                        )}
                      >
                        <span className="grid size-4 shrink-0 place-items-center">
                          <RowMarkView mark={mark} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{r.title}</span>
                        {r.kind !== "look" && (
                          <kind.Icon className="size-3.5 shrink-0 text-dt-faint" aria-hidden />
                        )}
                      </button>
                      {r.id === here && active}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}

/** What the agent does for him now. */
function Agent({ count, eta }: { readonly count: number; readonly eta: number | undefined }) {
  return (
    <span className="flex animate-dt-fade items-center gap-2 text-[12px] text-dt-muted">
      <span className="relative grid size-4 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-dt-accent/25" />
        <AgentMark className="relative size-3" />
      </span>
      <span className="flex-1">
        The agent works on {count === 1 ? "your annotation" : `${String(count)} annotations`}
      </span>
      {eta !== undefined && <span className="text-dt-faint tabular-nums">{eta} s</span>}
    </span>
  );
}

const KEYS = [
  ["←  →", "Back, Next"],
  ["Space", "Play or pause the agent's walk"],
  ["1–9", "Preview an option or a variant"],
  ["Enter", "Keep the preview"],
  ["Esc", "Stop or close"],
  ["⌃⌘ held", "Point and talk to the agent"],
  ["⌘Z  ⇧⌘Z", "Undo, redo"],
] as const;

function Keys() {
  return (
    <dl className="absolute top-11 right-3 z-10 grid w-64 animate-dt-arrive grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-dt-control bg-dt-raised p-3.5 text-[12px] shadow-dt-float">
      {KEYS.map(([key, what]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-[11px] whitespace-pre text-dt-faint">{key}</dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}

function RemarkView(props: PanelProps & { readonly remark: Remark; readonly inline?: boolean }) {
  const { queue: q, remark: r } = props;
  const kind = KIND[r.kind];
  const settled = isSettled(q, r.id);
  return (
    <section
      className={cx(
        "flex animate-dt-arrive flex-col gap-4",
        props.inline === true ? "px-2 pt-1 pb-3" : "px-4 pt-2 pb-5",
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-dt-faint">
          <kind.Icon className="size-3.5" aria-hidden />
          {kind.label}
          <span aria-hidden>·</span>
          <span className="font-normal">{pageTitle(r.page)}</span>
          <span className="flex-1" />
          {settled ? (
            <span className="flex items-center gap-1 text-dt-good">
              <Check className="size-3.5" aria-hidden />
              Settled
            </span>
          ) : (
            props.walk !== undefined && <WalkControls {...props} phase={props.walk} />
          )}
        </span>
        {props.inline !== true && (
          <h2 className="text-[17px] leading-6 font-semibold tracking-[-0.01em] text-balance">
            {r.title}
          </h2>
        )}
        {r.text !== undefined && r.kind !== "answer" && (
          <p className="text-[13px] leading-5 text-pretty text-dt-muted">{r.text}</p>
        )}
      </div>
      {r.kind === "answer" && (
        <AnswerView queue={q} remark={r} before={props.before === true} onBefore={props.onBefore} />
      )}
      {r.kind === "choice" && r.variants !== undefined && (
        <Choices
          values={r.variants}
          picked={q.picks[r.id]}
          peek={props.peek}
          verb="Keep"
          draw={props.preview === undefined ? undefined : (v) => props.preview?.(r, v, props.state)}
          onPeek={props.onPeek}
          onPick={props.onPick}
          states={
            r.states === undefined ? undefined : (
              <States states={r.states} shown={props.state} onState={props.onState} />
            )
          }
        />
      )}
      {r.kind === "question" && r.options !== undefined && (
        <Choices
          values={r.options}
          picked={q.picks[r.id]}
          peek={props.peek}
          verb="Answer"
          draw={props.preview === undefined ? undefined : (v) => props.preview?.(r, v, props.state)}
          onPeek={props.onPeek}
          onPick={props.onPick}
        />
      )}
    </section>
  );
}

/** The agent's cursor for this remark: walk it, pause it or go on, and its voice. Both are
 * the guide's own controls, so a press on them does not pause the walk. */
function WalkControls(props: PanelProps & { readonly phase: Phase }) {
  const running = props.phase === "moving" || props.phase === "speaking" || props.phase === "turn";
  const stopped = props.phase === "paused" || props.phase === "lost";
  const control =
    "-my-1 flex items-center gap-1 rounded-full px-2 py-1 font-medium text-dt-muted hover:bg-dt-raised hover:text-dt-text";
  const beat = props.beat;
  return (
    <span data-guide-ui="" className="-mr-1.5 flex items-center">
      {beat !== undefined && beat.of > 1 && (running || stopped) && (
        // How far the walk has come: a short line for each beat.
        <span className="mr-1 flex animate-dt-fade items-center gap-[3px]" aria-hidden>
          {Array.from({ length: beat.of }, (_, i) => (
            <span
              key={i}
              className={cx(
                "h-[3px] rounded-full transition-all duration-300",
                i === beat.at ? "w-3 bg-dt-accent" : "w-1.5",
                i < beat.at ? "bg-dt-accent/50" : i > beat.at && "bg-dt-line",
              )}
            />
          ))}
        </span>
      )}
      <button type="button" onClick={props.onWalk} className={control} title="Space: play or pause">
        {running ? (
          <>
            <Pause className="size-3.5" aria-hidden />
            Pause
          </>
        ) : stopped ? (
          <>
            <Play className="size-3.5" aria-hidden />
            Go on
          </>
        ) : (
          <>
            <Play className="size-3.5" aria-hidden />
            Show me
          </>
        )}
      </button>
      <button
        type="button"
        aria-label={props.voice === true ? "Mute the voice" : "Turn the voice on"}
        aria-pressed={props.voice === true}
        onClick={props.onVoice}
        className={cx(control, "w-7 justify-center px-0")}
      >
        {props.voice === true && props.phase === "speaking" ? (
          <Speaking />
        ) : props.voice === true ? (
          <Volume2 className="size-3.5" aria-hidden />
        ) : (
          <VolumeX className="size-3.5" aria-hidden />
        )}
      </button>
    </span>
  );
}

/** The agent's voice as it speaks, as Clicky's notch shows it: three bars that dance. */
function Speaking() {
  return (
    <span className="flex h-3.5 items-center gap-[2px]" aria-hidden>
      {[0, 180, 90].map((delay) => (
        <span
          key={delay}
          className="h-full w-[2.5px] origin-center rounded-full bg-dt-accent"
          style={{ animation: `dt-eq 720ms ease-in-out ${String(delay)}ms infinite alternate` }}
        />
      ))}
    </span>
  );
}

/** What he wrote, and what the agent changed for it: the words before and after. */
/** What he said, and what the agent changed for it. Was and Now are not only words: a hover
 * on Was, or b held, shows the element on the page as it was; letting go shows it as it is. */
function AnswerView({
  queue: q,
  remark: r,
  before,
  onBefore,
}: {
  readonly queue: Queue;
  readonly remark: Remark;
  readonly before: boolean;
  readonly onBefore: ((on: boolean) => void) | undefined;
}) {
  const asked = q.annotations.filter((a) => r.answers?.includes(a.id));
  const change = changeOf(targetOf(r.target));
  const row = (on: boolean) =>
    cx(
      "col-span-2 grid grid-cols-subgrid items-baseline rounded-[6px] px-2 py-1 transition-colors",
      on ? "bg-dt-line" : "hover:bg-dt-line/60",
    );
  const shows = (
    <span className="flex items-center gap-1 justify-self-end text-[11px] font-medium text-dt-faint">
      <Eye className="size-3.5" aria-hidden />
      On the page
    </span>
  );
  return (
    <div className="flex flex-col gap-3">
      {asked.map((a) => (
        <figure key={a.id} className="flex gap-2.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-dt-text text-dt-ground">
            <PenLine className="size-2.5" aria-hidden />
          </span>
          <blockquote className="text-[13px] leading-5 text-dt-text">{a.text}</blockquote>
        </figure>
      ))}
      <dl
        className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-0.5 rounded-dt-control bg-dt-raised px-1 py-1.5 text-[13px] leading-5"
        onPointerLeave={() => onBefore?.(false)}
      >
        <dt className="col-span-3 px-2 pb-1 text-[11px] font-medium text-dt-faint">
          {capital(TARGETS[targetOf(r.target)] ?? "the element")}
        </dt>
        <div className={cx(row(before), "col-span-3")} onPointerEnter={() => onBefore?.(true)}>
          <dt className="text-[11px] text-dt-faint">Was</dt>
          <dd
            className={cx(
              "text-dt-faint decoration-dt-bad/60",
              before ? "text-dt-muted" : "line-through",
            )}
          >
            {change.before}
          </dd>
          {before && shows}
        </div>
        <div className={cx(row(!before), "col-span-3")} onPointerEnter={() => onBefore?.(false)}>
          <dt className="text-[11px] text-dt-faint">Now</dt>
          <dd className="font-medium">{change.after}</dd>
          {!before && shows}
        </div>
      </dl>
      {r.text !== undefined && <p className="text-[13px] leading-5 text-dt-muted">{r.text}</p>}
    </div>
  );
}

/** A choice: each variant drawn small in the app's own look, numbered for its key. */
/**
 * The choices of a remark: variants drawn small in the app's own look, or a question's
 * answers. A hover or a number previews one on the page and keeps nothing. Only a click on
 * it, or Keep, keeps it.
 */
function Choices({
  values,
  picked,
  peek,
  verb,
  draw,
  onPeek,
  onPick,
  states,
}: {
  readonly values: readonly string[];
  readonly picked: string | undefined;
  readonly peek: string | undefined;
  /** What keeping one does, in a word: Keep, or Answer. */
  readonly verb: string;
  /** Draws one variant small; a question has none. */
  readonly draw: ((value: string) => ReactNode) | undefined;
  readonly onPeek: ((value: string | undefined) => void) | undefined;
  readonly onPick: (value: string) => void;
  /** Goes through the part's states, above the variants that it draws. */
  readonly states?: ReactNode;
}) {
  const pending = peek !== undefined && peek !== picked ? peek : undefined;
  return (
    <div className="flex flex-col gap-2">
      {states}
      <ol
        data-board-list=""
        className="flex flex-col gap-2"
        onPointerLeave={() => onPeek?.(undefined)}
      >
        {values.map((v, i) => {
          const kept = picked === v;
          const shows = pending === v;
          return (
            // The options come in one after another, as the agent lays them out.
            <li
              key={v}
              style={{ animation: `dt-arrive 260ms ease-out ${String(60 + i * 70)}ms both` }}
            >
              <button
                type="button"
                data-board={String(i + 1)}
                aria-pressed={kept}
                onPointerEnter={() => onPeek?.(v)}
                onFocus={() => onPeek?.(v)}
                onClick={() => onPick(v)}
                className={cx(
                  "flex w-full flex-col overflow-hidden rounded-dt-control text-left transition-[box-shadow,background-color] duration-150",
                  kept
                    ? "bg-dt-accent/10 ring-2 ring-dt-accent"
                    : shows
                      ? "bg-dt-raised ring-2 ring-dt-accent/45"
                      : "bg-dt-raised ring-1 ring-dt-line hover:ring-dt-faint/60",
                )}
              >
                {draw !== undefined && (
                  <span className="flex h-16 items-center justify-center bg-[#fbfbfc] text-[#16161a]">
                    {draw(v)}
                  </span>
                )}
                <span className="flex items-center gap-2.5 px-2.5 py-2 text-[13px] leading-5">
                  <Number n={i + 1} on={kept} />
                  <span className={cx("flex-1", draw !== undefined && "font-medium")}>{v}</span>
                  {kept ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-dt-accent">
                      <Check className="size-3.5" aria-hidden />
                      Kept
                    </span>
                  ) : (
                    shows && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-dt-faint">
                        <Eye className="size-3.5" aria-hidden />
                        Preview
                      </span>
                    )
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {pending !== undefined && (
        <button
          type="button"
          onClick={() => onPick(pending)}
          className={cx(primary, "animate-dt-fade justify-center self-stretch")}
        >
          {verb} {pending}
        </button>
      )}
    </div>
  );
}

/**
 * The part's states, one at a time: back and on, the state's name at a fixed width, and a dot
 * for each state. The page and every variant above show the state; none is kept.
 */
function States({
  states,
  shown,
  onState,
}: {
  readonly states: readonly string[];
  readonly shown: string | undefined;
  readonly onState: ((state: string | undefined) => void) | undefined;
}) {
  const at = Math.max(0, states.indexOf(shown ?? ""));
  const go = (i: number) => {
    const n = (i + states.length) % states.length;
    onState?.(n === 0 ? undefined : states[n]);
  };
  const step =
    "grid size-7 shrink-0 place-items-center rounded-[6px] text-dt-muted hover:bg-dt-line hover:text-dt-text";
  return (
    <div className="flex h-9 items-center gap-1 rounded-dt-control bg-dt-raised pr-2.5 pl-1 text-[13px]">
      <button
        type="button"
        aria-label="The state before"
        className={step}
        onClick={() => go(at - 1)}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-center font-medium">{states[at]}</span>
      <button type="button" aria-label="The next state" className={step} onClick={() => go(at + 1)}>
        <ChevronRight className="size-4" aria-hidden />
      </button>
      <span className="flex items-center gap-1 pl-1.5">
        {states.map((s, i) => (
          <button
            key={s}
            type="button"
            aria-label={s}
            title={s}
            onClick={() => go(i)}
            className="grid size-3 place-items-center"
          >
            <span
              className={cx(
                "size-1.5 rounded-full transition-colors",
                i === at ? "bg-dt-accent" : "bg-dt-faint/50 hover:bg-dt-muted",
              )}
            />
          </button>
        ))}
      </span>
    </div>
  );
}

function Number({ n, on }: { readonly n: number; readonly on: boolean }) {
  return (
    <span
      className={cx(
        "grid size-5 shrink-0 place-items-center rounded-[6px] text-[11px] font-semibold tabular-nums transition-colors",
        on ? "bg-dt-accent text-white" : "bg-dt-line text-dt-muted",
      )}
    >
      {n}
    </span>
  );
}

/** What Next shows, so the next move is never a surprise. */
function UpNext({
  queue: q,
  eta,
  forward,
}: {
  readonly queue: Queue;
  readonly eta: number | undefined;
  readonly forward: boolean;
}) {
  const next = ahead(q)[0];
  const after = next?.kind === "remark" ? next.remark : undefined;
  if (next === undefined) return null;
  const kind = after === undefined ? undefined : KIND[after.kind];
  return (
    <div className="flex h-10 shrink-0 items-center gap-2.5 border-t border-dt-line px-4 text-[12px]">
      <span className="text-dt-faint">Next</span>
      {after !== undefined && kind !== undefined ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-dt-muted">
          <kind.Icon className="size-3.5 shrink-0 text-dt-faint" aria-hidden />
          <span className="truncate">{after.title}</span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-dt-muted">
          <AgentMark className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">The agent's answer</span>
          {eta !== undefined && !forward && (
            <span className="ml-auto text-dt-faint tabular-nums">{eta} s</span>
          )}
        </span>
      )}
    </div>
  );
}

/** Nothing shows: before the first remark, or with all settled and answers to come. */
function Idle({ queue: q, eta }: { readonly queue: Queue; readonly eta: number | undefined }) {
  const open = order(q).length;
  const wait = waiting(q).length;
  return (
    <section className="flex flex-1 animate-dt-fade flex-col items-center justify-center gap-3 px-8 text-center">
      <span
        className={cx(
          "grid size-11 place-items-center rounded-full",
          wait > 0 ? "bg-dt-accent/12 text-dt-accent" : "bg-dt-good/12 text-dt-good",
        )}
      >
        {wait > 0 ? (
          <AgentMark className="size-5 animate-pulse" />
        ) : (
          <Check className="size-5" aria-hidden />
        )}
      </span>
      <span className="text-[15px] font-semibold">
        {open > 0
          ? `${String(open)} remarks for you`
          : wait > 0
            ? "The agent is on it"
            : "Nothing needs you"}
      </span>
      {open === 0 && wait > 0 && (
        <span className="text-[13px] leading-5 text-dt-muted">
          Your answer comes here{eta !== undefined ? ` in about ${String(eta)} s` : ""}.
        </span>
      )}
    </section>
  );
}

/** Every remark is settled: the agent ships the journey, and a ring counts down. */
function Shipping({
  ship,
  onStop,
}: {
  readonly ship: Ship | undefined;
  readonly onStop: () => void;
}) {
  const shipped = ship?.in === "shipped";
  const share = shipped ? 1 : 1 - (typeof ship?.in === "number" ? ship.in : 0) / SHIP_SECONDS;
  return (
    <section className="flex flex-1 animate-dt-fade flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="relative grid size-14 place-items-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2" className="stroke-dt-raised" />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - share}
            className={cx(
              "transition-[stroke-dashoffset] duration-1000 ease-linear",
              shipped ? "stroke-dt-good" : "stroke-dt-accent",
            )}
          />
        </svg>
        {shipped ? (
          <Check className="size-6 text-dt-good" aria-hidden />
        ) : (
          <GitMerge className="size-5 text-dt-accent" aria-hidden />
        )}
      </span>
      <span className="text-[15px] font-semibold">{shipped ? "Merged" : "All settled"}</span>
      <span className="text-[13px] leading-5 text-dt-muted">
        {shipped ? (
          <>{JOURNEY} is on main.</>
        ) : (
          <>
            The agent ships {JOURNEY} in{" "}
            <span className="text-dt-text tabular-nums">{ship?.in ?? 0} s</span>.
          </>
        )}
      </span>
      {!shipped && (
        <button type="button" className={cx(ghost, "mt-1")} onClick={onStop}>
          Wait, not yet
        </button>
      )}
    </section>
  );
}

/**
 * The line between him and the agent, in the place of the next remark's line: what it heard
 * him say, and under it what it does about it, live. The page shows where it points; this
 * says what it took from his words, so a wrong hearing shows at once: first his words, then
 * in one line what a fast model heard him ask for, a second later. While the agent works,
 * a light runs along the line's top edge and its words shimmer. Once it is done, its last
 * words stay, with when a change it put in the queue comes back, and Again shows its walk
 * again.
 */
/** What the answer should have been, in his words: the start of an eval case. */
function WrongBox({ wrong }: { readonly wrong: Wrong }) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex animate-dt-fade items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim() !== "") wrong.onSend(reason.trim());
      }}
    >
      <input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- it opens on his own key or click
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            wrong.onClose();
          }
        }}
        onBlur={() => {
          if (reason.trim() === "") wrong.onClose();
        }}
        placeholder="What should it have done?"
        aria-label="What should it have done?"
        className="min-w-0 flex-1 rounded-md border border-dt-line bg-dt-raised px-2 py-1 text-dt-text outline-none placeholder:text-dt-faint focus:border-dt-accent"
      />
    </form>
  );
}

function ExchangeLine({ line }: { readonly line: Line }) {
  const busy = line.tone === "busy" || line.tone === "listening";
  return (
    <div className="relative flex shrink-0 flex-col gap-1.5 border-t border-dt-line px-4 py-2.5 text-[12px] leading-[1.4]">
      {busy && (
        <span aria-hidden className="absolute inset-x-0 -top-px h-px overflow-hidden">
          <span className="block h-full w-1/3 animate-[dt-scan_1.6s_ease-in-out_infinite] bg-linear-to-r from-transparent via-dt-accent to-transparent" />
        </span>
      )}
      {line.said !== undefined && (
        <span key={line.said} className="flex animate-dt-fade items-start gap-2.5">
          <Mic className="mt-px size-3.5 shrink-0 text-dt-faint" aria-hidden />
          <span className="line-clamp-2 min-w-0 flex-1 text-dt-text" title={line.said}>
            {line.said}
          </span>
        </span>
      )}
      {line.heard !== undefined && (
        <span className="flex animate-dt-fade items-start gap-2.5">
          <CornerDownRight className="mt-px size-3.5 shrink-0 text-dt-faint" aria-hidden />
          <span className="line-clamp-2 min-w-0 flex-1 text-dt-text" title={line.heard}>
            {line.heard}
          </span>
        </span>
      )}
      <span className="flex min-h-5 items-center gap-2.5" role="status">
        {line.tone === "listening" ? (
          <Mic className="size-3.5 shrink-0 animate-pulse text-dt-accent" aria-hidden />
        ) : (
          <AgentMark
            className={cx(
              "size-3.5 shrink-0",
              busy && "animate-pulse",
              line.tone === "failed" && "opacity-50",
            )}
          />
        )}
        <span
          key={line.status}
          className={cx(
            "line-clamp-2 min-w-0 flex-1 animate-dt-fade",
            busy ? "dt-shimmer" : line.tone === "failed" ? "text-dt-warn" : "text-dt-muted",
          )}
        >
          {line.status}
        </span>
        {line.beat !== undefined && line.beat.of > 1 && (
          <span className="flex items-center gap-[3px]" aria-hidden>
            {Array.from({ length: line.beat.of }, (_, i) => (
              <span
                key={i}
                className={cx(
                  "h-[3px] rounded-full transition-all duration-300",
                  i === line.beat?.at ? "w-3 bg-dt-accent" : "w-1.5",
                  i < (line.beat?.at ?? 0)
                    ? "bg-dt-accent/50"
                    : i > (line.beat?.at ?? 0) && "bg-dt-line",
                )}
              />
            ))}
          </span>
        )}
        {line.change !== undefined && (
          <span className="shrink-0 text-dt-faint tabular-nums">{line.change}</span>
        )}
      </span>
      {(line.wrong !== undefined || line.onAgain !== undefined) && (
        <span className="-mb-1 flex items-center gap-0.5 pl-5">
          {line.wrong !== undefined && (
            <button
              type="button"
              data-guide-ui=""
              aria-label="Bad answer"
              title="Bad answer: say what it should have done, and it becomes an eval case"
              disabled={line.wrong.state !== "idle"}
              onClick={line.wrong.onOpen}
              className={action}
            >
              <ThumbsDown
                className={cx(
                  "size-3.5",
                  line.wrong.state !== "idle" && line.wrong.state !== "failed" && "fill-current",
                )}
                aria-hidden
              />
            </button>
          )}
          {line.onAgain !== undefined && (
            <button
              type="button"
              data-guide-ui=""
              aria-label="Try again"
              title="Try again"
              onClick={line.onAgain}
              className={action}
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </button>
          )}
          {line.wrong?.state === "failed" && <span className="pl-1 text-dt-warn">Not saved</span>}
        </span>
      )}
      {line.wrong?.state === "asking" && <WrongBox wrong={line.wrong} />}
    </div>
  );
}

const action =
  "grid size-6 place-items-center rounded-[6px] text-dt-faint enabled:hover:bg-dt-raised enabled:hover:text-dt-text disabled:text-dt-muted";

/** The settle that just happened, in the place of the next remark's line, with undo. */
function Toast({ count, onUndo }: { readonly count: number; readonly onUndo: () => void }) {
  return (
    <div className="flex h-10 shrink-0 animate-dt-fade items-center gap-2.5 border-t border-dt-line px-4 text-[12px]">
      <span className="grid size-4 place-items-center rounded-full bg-dt-good text-dt-ground">
        <Check className="size-2.5" strokeWidth={3} aria-hidden />
      </span>
      <span className="flex-1">{count === 1 ? "Settled" : `${String(count)} settled`}</span>
      <button
        type="button"
        className="-mr-2 rounded-dt-control px-2 py-1 text-dt-muted hover:bg-dt-raised hover:text-dt-text"
        onClick={onUndo}
      >
        Undo
      </button>
    </div>
  );
}

function LeftOpen({ onSettle }: { readonly onSettle: (() => void) | undefined }) {
  return (
    <div className="flex h-10 shrink-0 animate-dt-fade items-center gap-2.5 border-t border-dt-line px-4 text-[12px]">
      <span className="size-4 rounded-full border-[1.5px] border-dashed border-dt-faint" />
      <span className="flex-1">Not tried yet, so it comes again</span>
      {onSettle !== undefined && (
        <button
          type="button"
          className="-mr-2 rounded-dt-control px-2 py-1 text-dt-muted hover:bg-dt-raised hover:text-dt-text"
          onClick={onSettle}
        >
          Settle
        </button>
      )}
    </div>
  );
}

function ComposerView(props: PanelProps & { readonly composer: Composer }) {
  const { composer } = props;
  return (
    <footer className="flex shrink-0 animate-dt-fade flex-col gap-2 border-t border-dt-line p-3">
      <span className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-dt-faint">
        <PenLine className="size-3" aria-hidden />
        On {TARGETS[targetOf(composer.target)] ?? "the page"}
      </span>
      <textarea
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer opens to be written in
        autoFocus
        rows={3}
        value={composer.text}
        placeholder="What should change?"
        onChange={(e) => props.onWrite(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            props.onSend();
          } else if (e.key === "Escape") props.onCancel();
          e.stopPropagation();
        }}
        className="resize-none rounded-dt-control bg-dt-raised px-3 py-2.5 text-[13px] leading-5 ring-1 ring-transparent outline-none placeholder:text-dt-faint focus:ring-dt-accent/60"
      />
      <div className="flex justify-end gap-1">
        <button type="button" className={ghost} onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={primary}
          disabled={composer.text.trim() === ""}
          onClick={props.onSend}
        >
          Send
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </footer>
  );
}

export const noop = () => undefined;

/** A panel's props with every action doing nothing, for the states page. */
export const still = (queue: Queue, more: Partial<PanelProps> = {}): PanelProps => ({
  queue,
  eta: undefined,
  composer: undefined,
  toast: [],
  ship: undefined,
  onNext: noop,
  onBack: noop,
  onAnnotate: noop,
  onWrite: noop,
  onSend: noop,
  onCancel: noop,
  onPick: noop,
  onUndo: noop,
  onStop: noop,
  ...more,
});
