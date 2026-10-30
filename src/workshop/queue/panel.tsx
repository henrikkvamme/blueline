import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  CornerDownRight,
  Eye,
  GitMerge,
  PenLine,
  Shuffle,
  Sparkles,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  annotationsOn,
  answerOf,
  current,
  done,
  held,
  isSettled,
  left,
  order,
  remarkOf,
  waiting,
  type Kind,
  type Queue,
  type Remark,
} from "../../queue/queue";
import { cx } from "../../ui/cx";
import { PANEL } from "../../ui/geometry";
import { JOURNEY, PAGES, TARGETS, changeOf, targetOf } from "./script";

/*
 * The panel of the queue prototype: the remark that shows, what waits on the agent, what
 * comes next, and Back and Next. It draws only from its props, so the states page draws each
 * state from a queue.
 */

export interface Composer {
  readonly target: string;
  readonly text: string;
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
  readonly preview?: (remark: Remark, variant: string) => ReactNode;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onAnnotate: () => void;
  readonly onWrite: (text: string) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onPick: (value: string) => void;
  readonly onUndo: () => void;
  readonly onStop: () => void;
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
  const forward = q.at < q.trail.length - 1 || order(q).length > 0;
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

/** The journey, how much is left, and a bar of its remarks: settled, with the agent, open,
 * and the one that shows. */
function Header({ queue: q, eta }: PanelProps) {
  const count = left(q);
  const [help, setHelp] = useState(false);
  const here = current(q);
  const remarks = q.remarks.filter((r) => r.kind !== "answer");
  const withAgent = (r: Remark) =>
    annotationsOn(q, r.id).some((a) => {
      const answer = answerOf(q, a.id);
      return answer === undefined || !isSettled(q, answer.id);
    });
  const wait = waiting(q).length;
  return (
    <header className="relative flex shrink-0 flex-col gap-2.5 px-4 pt-3.5 pb-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[13px] font-medium">{JOURNEY}</span>
        <span className="text-[12px] text-dt-faint tabular-nums">
          {count === 0 ? "Nothing left" : `${String(count)} left`}
        </span>
        <button
          type="button"
          aria-label="Keys"
          aria-expanded={help}
          onClick={() => setHelp((h) => !h)}
          className="-mr-1.5 grid size-6 place-items-center rounded-full text-[12px] text-dt-faint hover:bg-dt-raised hover:text-dt-text"
        >
          ?
        </button>
      </div>
      <div className="flex h-1 gap-[3px]" aria-hidden>
        {remarks.map((r) => {
          const shows =
            r.id === here?.id ||
            annotationsOn(q, r.id).some((a) => here?.answers?.includes(a.id) === true);
          const tone = isSettled(q, r.id)
            ? "bg-dt-good"
            : withAgent(r)
              ? "bg-dt-accent/45 animate-pulse"
              : "bg-dt-raised";
          return (
            <span
              key={r.id}
              className={cx(
                "h-full rounded-full transition-all duration-300 ease-out",
                shows === true ? "flex-[2.2] bg-dt-accent" : `flex-1 ${tone}`,
              )}
            />
          );
        })}
      </div>
      {wait > 0 && <Agent count={wait} eta={eta} />}
      {help && <Keys />}
    </header>
  );
}

/** What the agent does for him now. */
function Agent({ count, eta }: { readonly count: number; readonly eta: number | undefined }) {
  return (
    <span className="flex animate-dt-fade items-center gap-2 text-[12px] text-dt-muted">
      <span className="relative grid size-4 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-dt-accent/25" />
        <Sparkles className="relative size-3 text-dt-accent" aria-hidden />
      </span>
      <span className="flex-1">
        The agent works on {count === 1 ? "your annotation" : `${String(count)} annotations`}
      </span>
      {eta !== undefined && <span className="text-dt-faint tabular-nums">{eta} s</span>}
    </span>
  );
}

const KEYS = [
  ["j  →", "Next"],
  ["k  ←", "Back"],
  ["a", "Annotate what shows"],
  ["Alt+click", "Annotate any element"],
  ["1–9", "Pick a variant or an answer"],
  ["y", "Settle now and go on"],
  ["u", "Undo the last settle"],
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
          {settled && (
            <span className="flex items-center gap-1 text-dt-good">
              <Check className="size-3.5" aria-hidden />
              Settled
            </span>
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
        <Variants
          remark={r}
          values={r.variants}
          picked={q.picks[r.id]}
          preview={props.preview}
          onPick={props.onPick}
        />
      )}
      {r.kind === "question" && r.options !== undefined && (
        <Options values={r.options} picked={q.picks[r.id]} onPick={props.onPick} />
      )}
      {mine.length > 0 && <Mine queue={q} remark={r} />}
    </section>
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
function Variants({
  remark,
  values,
  picked,
  preview,
  onPick,
}: {
  readonly remark: Remark;
  readonly values: readonly string[];
  readonly picked: string | undefined;
  readonly preview: PanelProps["preview"];
  readonly onPick: (value: string) => void;
}) {
  return (
    <ol className="grid grid-cols-1 gap-2">
      {values.map((v, i) => {
        const on = picked === v;
        return (
          <li key={v}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onPick(v)}
              className={cx(
                "group flex w-full flex-col overflow-hidden rounded-dt-control text-left ring-1 transition-[box-shadow,background-color] duration-150",
                on
                  ? "bg-dt-accent/10 ring-2 ring-dt-accent"
                  : "bg-dt-raised ring-dt-line hover:ring-dt-faint/60",
              )}
            >
              <span className="flex h-16 items-center justify-center bg-[#fbfbfc] text-[#16161a]">
                {preview?.(remark, v) ?? <span className="text-[13px]">{v}</span>}
              </span>
              <span className="flex items-center gap-2 px-2.5 py-2 text-[13px]">
                <Number n={i + 1} on={on} />
                <span className="flex-1 font-medium">{v}</span>
                {on && <Check className="size-3.5 text-dt-accent" aria-hidden />}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Options({
  values,
  picked,
  onPick,
}: {
  readonly values: readonly string[];
  readonly picked: string | undefined;
  readonly onPick: (value: string) => void;
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {values.map((v, i) => {
        const on = picked === v;
        return (
          <li key={v}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onPick(v)}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-dt-control px-3 py-2.5 text-left text-[13px] leading-5 ring-1 transition-[box-shadow,background-color] duration-150",
                on
                  ? "bg-dt-accent/10 ring-2 ring-dt-accent"
                  : "bg-dt-raised ring-transparent hover:ring-dt-line",
              )}
            >
              <Number n={i + 1} on={on} />
              <span className="flex-1">{v}</span>
              {on && <Check className="size-3.5 text-dt-accent" aria-hidden />}
            </button>
          </li>
        );
      })}
    </ol>
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
                    <Sparkles className="size-3 animate-pulse text-dt-accent" aria-hidden />
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
  const after =
    q.at < q.trail.length - 1 ? remarkOf(q, q.trail[q.at + 1]) : (order(q)[0] ?? undefined);
  const hold = held(q).length;
  if (after === undefined && hold === 0 && waiting(q).length === 0) return null;
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
          <Sparkles className="size-3.5 shrink-0 animate-pulse text-dt-accent" aria-hidden />
          <span className="truncate">
            {hold > 0 ? `${String(hold)} more after the agent's answer` : "The agent's answer"}
          </span>
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
          <Sparkles className="size-5 animate-pulse" aria-hidden />
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
