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
  History,
  PenLine,
  Shuffle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ahead,
  annotationsOn,
  answerOf,
  current,
  done,
  isSettled,
  left,
  order,
  seen,
  waiting,
  type Drawn,
  type Kind,
  type Moment,
  type Pointed,
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
  /** Spoken words send themselves at this time, in ms, unless he holds them to edit. */
  readonly sendsAt?: number | undefined;
  /** Spoken: the elements he pointed at and what he drew, and what showed. */
  readonly pointed?: readonly Pointed[] | undefined;
  readonly drawn?: readonly Drawn[] | undefined;
  readonly moment?: Moment | undefined;
}

export interface Ship {
  /** Seconds until the merge, or "shipped". */
  readonly in: number | "shipped";
}

/** How long the agent waits after the last settle before it ships. */
export const SHIP_SECONDS = 10;

export interface PanelProps {
  readonly queue: Queue;
  /** Seconds until the agent's next answer comes. */
  readonly eta: number | undefined;
  readonly composer: Composer | undefined;
  readonly toast: readonly string[];
  readonly ship: Ship | undefined;
  /** Draws one variant of a choice, small, in the app's own look. */
  readonly preview?: (remark: Remark, variant: string, state: string | undefined) => ReactNode;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onAnnotate: () => void;
  readonly onWrite: (text: string) => void;
  /** He touched the spoken words: they wait for his Send. */
  readonly onHold?: () => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onPick: (value: string) => void;
  readonly onUndo: () => void;
  readonly onStop: () => void;
  /** Show one remark: from the bar, or from Seen. */
  readonly onShow?: (id: string) => void;
  /** Whether Seen, the list of the remarks seen before, is open. */
  readonly seen?: boolean;
  readonly onSeen?: (open: boolean) => void;
  /** The choice that shows on the page and is not kept. */
  readonly peek?: string | undefined;
  readonly onPeek?: (value: string | undefined) => void;
  /** The state that a choice's part shows, of its states; none for the page's own. */
  readonly state?: string | undefined;
  readonly onState?: (state: string | undefined) => void;
  /** Where the agent's cursor is on this remark's walk; none when it has no walk. */
  readonly walk?: Phase | undefined;
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

export function Panel(props: PanelProps) {
  const { queue: q } = props;
  const here = current(q);
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {shipping ? (
          <Shipping ship={props.ship} onStop={props.onStop} />
        ) : here === undefined ? (
          <Idle queue={q} eta={props.eta} />
        ) : (
          <RemarkView key={here.id} {...props} remark={here} />
        )}
      </div>
      {props.composer === undefined &&
        (props.toast.length > 0 ? (
          <Toast count={props.toast.length} onUndo={props.onUndo} />
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
  const before = seen(q);
  const wait = waiting(q).length;
  const tab =
    "grid h-6 place-items-center rounded-full text-[12px] text-dt-faint hover:bg-dt-raised hover:text-dt-text aria-expanded:bg-dt-raised aria-expanded:text-dt-text";
  return (
    <header className="relative flex shrink-0 flex-col gap-2.5 px-4 pt-3.5 pb-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[13px] font-medium">{JOURNEY}</span>
        <span className="text-[12px] text-dt-faint tabular-nums">
          {count === 0 ? "Nothing left" : `${String(count)} left`}
        </span>
        <span className="-mr-1.5 flex items-center">
          <button
            type="button"
            aria-label="Seen"
            title="Seen"
            aria-expanded={props.seen === true}
            disabled={before.length === 0}
            onClick={() => props.onSeen?.(props.seen !== true)}
            className={cx(tab, "size-6 disabled:opacity-35")}
          >
            <History className="size-3.5" aria-hidden />
          </button>
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
      {props.seen === true && (
        <Seen
          remarks={before}
          queue={q}
          onShow={(id) => {
            props.onShow?.(id);
            props.onSeen?.(false);
          }}
        />
      )}
    </header>
  );
}

/** The remarks seen before, the last first: a click shows one again. */
function Seen({
  remarks,
  queue: q,
  onShow,
}: {
  readonly remarks: readonly Remark[];
  readonly queue: Queue;
  readonly onShow: (id: string) => void;
}) {
  return (
    <ul className="absolute top-11 right-3 left-3 z-10 flex max-h-80 animate-dt-arrive flex-col overflow-y-auto rounded-dt-control bg-dt-raised p-1 text-[12px] shadow-dt-float">
      {remarks.map((r) => {
        const kind = KIND[r.kind];
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onShow(r.id)}
              className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-dt-muted hover:bg-dt-line hover:text-dt-text"
            >
              <kind.Icon className="size-3.5 shrink-0 text-dt-faint" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              {isSettled(q, r.id) ? (
                <Check className="size-3.5 shrink-0 text-dt-good" aria-label="Settled" />
              ) : annotationsOn(q, r.id).some((a) => answerOf(q, a.id) === undefined) ? (
                <AgentMark className="size-3.5 shrink-0 animate-pulse" />
              ) : (
                <span className="shrink-0 text-dt-faint">{pageTitle(r.page)}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
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
  ["j", "Next"],
  ["k", "Back"],
  ["s", "Seen: the remarks before"],
  ["←  →", "The variant before, after"],
  ["↑  ↓", "The state before, after"],
  ["a", "Annotate what shows"],
  ["⌥⌘ held", "Point, draw and talk"],
  ["1–9", "Preview a variant or an answer"],
  ["Enter", "Keep what the preview shows"],
  ["y", "Settle now and go on"],
  ["u", "Undo the last settle"],
  ["g", "Show me, pause, go on"],
  ["m", "Mute the voice"],
  ["Esc", "Pause the cursor; again, stop it"],
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

function RemarkView(props: PanelProps & { readonly remark: Remark }) {
  const { queue: q, remark: r } = props;
  const kind = KIND[r.kind];
  const settled = isSettled(q, r.id);
  const mine = annotationsOn(q, r.id);
  return (
    <section className="flex animate-dt-arrive flex-col gap-4 px-4 pt-2 pb-5">
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
        <h2 className="text-[17px] leading-6 font-semibold tracking-[-0.01em] text-balance">
          {r.title}
        </h2>
        {r.text !== undefined && r.kind !== "answer" && (
          <p className="text-[13px] leading-5 text-pretty text-dt-muted">{r.text}</p>
        )}
      </div>
      {r.kind === "answer" && <AnswerView queue={q} remark={r} />}
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
          draw={undefined}
          onPeek={props.onPeek}
          onPick={props.onPick}
        />
      )}
      {mine.length > 0 && <Mine queue={q} remark={r} />}
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
  return (
    <span data-guide-ui="" className="-mr-1.5 flex items-center">
      <button type="button" onClick={props.onWalk} className={control}>
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
        {props.voice === true ? (
          <Volume2 className={cx("size-3.5", running && "text-dt-accent")} aria-hidden />
        ) : (
          <VolumeX className="size-3.5" aria-hidden />
        )}
      </button>
    </span>
  );
}

/** What he wrote, and what the agent changed for it: the words before and after. */
function AnswerView({ queue: q, remark: r }: { readonly queue: Queue; readonly remark: Remark }) {
  const asked = q.annotations.filter((a) => r.answers?.includes(a.id));
  const change = changeOf(targetOf(r.target));
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
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2 rounded-dt-control bg-dt-raised px-3 py-2.5 text-[13px] leading-5">
        <dt className="col-span-2 text-[11px] font-medium text-dt-faint">
          {capital(TARGETS[targetOf(r.target)] ?? "the element")}
        </dt>
        <dt className="text-[11px] text-dt-faint">Was</dt>
        <dd className="text-dt-faint line-through decoration-dt-bad/60">{change.before}</dd>
        <dt className="text-[11px] text-dt-faint">Now</dt>
        <dd className="font-medium">{change.after}</dd>
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
      <ol className="flex flex-col gap-2" onPointerLeave={() => onPeek?.(undefined)}>
        {values.map((v, i) => {
          const kept = picked === v;
          const shows = pending === v;
          return (
            <li key={v}>
              <button
                type="button"
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

/** His annotations on this remark, and where each one is. */
function Mine({ queue: q, remark: r }: { readonly queue: Queue; readonly remark: Remark }) {
  return (
    <ul className="flex flex-col gap-2.5 border-t border-dt-line pt-4">
      {annotationsOn(q, r.id).map((a) => {
        const answered = answerOf(q, a.id) !== undefined;
        return (
          <li key={a.id} className="flex items-start gap-2.5 text-[13px] leading-5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-dt-text text-dt-ground">
              <PenLine className="size-2.5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span>{a.text}</span>
              <span
                className={cx(
                  "flex items-center gap-1 text-[12px]",
                  answered ? "text-dt-good" : "text-dt-faint",
                )}
              >
                {answered ? (
                  <>
                    <Check className="size-3" aria-hidden />
                    Answered
                  </>
                ) : (
                  <>
                    <AgentMark className="size-3 animate-pulse" />
                    With the agent
                  </>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
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

const nameOf = (target: string | undefined) =>
  target === undefined ? undefined : TARGETS[targetOf(target)];

/**
 * What goes to the agent with the words, so he can check it: the elements he pointed at or
 * drew on while he spoke, the variant and the state that showed, and the agent's line that
 * he spoke over. Each is a quiet chip; the whole line is in its title.
 */
function Context({ composer }: { readonly composer: Composer }) {
  const own = nameOf(composer.target);
  const elements = [
    ...new Set(
      [...(composer.pointed ?? []), ...(composer.drawn ?? [])]
        .map((p) => nameOf(p.target))
        .filter((n): n is string => n !== undefined && n !== own),
    ),
  ];
  const drew = (composer.drawn?.length ?? 0) > 0;
  const { variant, state, over } = composer.moment ?? {};
  const chips = [
    ...elements.map((e) => ({ key: `e-${e}`, text: `Also ${e}`, title: undefined })),
    ...(drew ? [{ key: "drew", text: "Drawing", title: undefined }] : []),
    ...(variant !== undefined || state !== undefined
      ? [
          {
            key: "shown",
            text: [variant, state].filter((x) => x !== undefined).join(" · "),
            title: "What the part showed",
          },
        ]
      : []),
    ...(over !== undefined ? [{ key: "over", text: "Over the agent", title: over }] : []),
  ];
  if (chips.length === 0) return null;
  return (
    <span className="-mt-1 flex flex-wrap gap-1 px-0.5">
      {chips.map((c) => (
        <span
          key={c.key}
          title={c.title}
          className="max-w-full truncate rounded-[6px] bg-dt-raised px-1.5 py-0.5 text-[11px] text-dt-muted"
        >
          {c.text}
        </span>
      ))}
    </span>
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
      <Context composer={composer} />
      <textarea
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer opens to be written in
        autoFocus
        rows={3}
        value={composer.text}
        placeholder="What should change?"
        onChange={(e) => props.onWrite(e.target.value)}
        onPointerDown={props.onHold}
        onKeyDown={(e) => {
          if (e.key !== "Enter") props.onHold?.();
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
          className={cx(primary, "relative overflow-hidden")}
          disabled={composer.text.trim() === ""}
          onClick={props.onSend}
        >
          {composer.sendsAt !== undefined && (
            // Spoken words send themselves when the light drains, unless he touches them.
            <span
              key={composer.sendsAt}
              aria-hidden
              className="absolute inset-0 origin-left bg-white/20"
              style={{
                animation: `dt-drain ${String(Math.max(0, composer.sendsAt - Date.now()))}ms linear both`,
              }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            Send
            <ArrowRight className="size-4" aria-hidden />
          </span>
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
