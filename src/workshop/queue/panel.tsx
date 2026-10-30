import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Eye,
  LoaderCircle,
  MessageSquareReply,
  PenLine,
  Rocket,
  Shuffle,
} from "lucide-react";
import { useState } from "react";
import {
  annotationsOn,
  answerOf,
  current,
  done,
  held,
  isSettled,
  left,
  order,
  waiting,
  type Kind,
  type Queue,
  type Remark,
} from "../../queue/queue";
import { Changes } from "../../ui/blocks/page";
import { cx } from "../../ui/cx";
import { JOURNEY, TARGETS, changeOf, targetOf } from "./script";

/*
 * The panel of the queue prototype: the remark that shows, what waits on the agent, and Back
 * and Next. It draws only from its props, so the states page draws each state from a queue.
 */

export interface Composer {
  readonly target: string;
  readonly text: string;
}

export interface Ship {
  /** Seconds until the merge, or "shipped". */
  readonly in: number | "shipped";
}

export interface PanelProps {
  readonly queue: Queue;
  /** Seconds until the agent's next answer comes. */
  readonly eta: number | undefined;
  readonly composer: Composer | undefined;
  readonly toast: readonly string[];
  readonly ship: Ship | undefined;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onAnnotate: () => void;
  readonly onWrite: (text: string) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onPick: (value: string) => void;
  readonly onUndo: () => void;
  readonly onStop: () => void;
  /** In the page's corner, or in the flow of the states page. */
  readonly floating?: boolean;
}

const KIND: Readonly<Record<Kind, { readonly label: string; readonly Icon: typeof Eye }>> = {
  look: { label: "Look", Icon: Eye },
  answer: { label: "Answer", Icon: MessageSquareReply },
  choice: { label: "Choose", Icon: Shuffle },
  question: { label: "Question", Icon: CircleHelp },
};

const button =
  "flex h-8 items-center gap-1.5 rounded-dt-control px-2.5 text-[13px] font-medium disabled:opacity-40";
const ghost = `${button} text-dt-muted enabled:hover:bg-dt-raised enabled:hover:text-dt-text`;
const primary = `${button} bg-dt-accent text-white enabled:hover:brightness-110`;

export function Panel(props: PanelProps) {
  const { queue: q } = props;
  const here = current(q);
  const forward = q.at < q.trail.length - 1 || order(q).length > 0;
  const shipping = done(q) && props.ship !== undefined;
  return (
    <aside
      aria-label="Blueline"
      className={cx(
        "blueline flex w-[360px] flex-col rounded-dt-panel bg-dt-panel text-dt-text shadow-dt-float",
        props.floating === true ? "fixed top-3 right-3 bottom-3 z-[2147483002]" : "relative h-full",
      )}
    >
      <Header {...props} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-1 pb-4">
        {shipping ? (
          <Shipping ship={props.ship} onStop={props.onStop} />
        ) : here === undefined ? (
          <Idle queue={q} eta={props.eta} />
        ) : (
          <RemarkView {...props} remark={here} />
        )}
        {!shipping && here !== undefined && !forward && <Holding queue={q} eta={props.eta} />}
      </div>
      {props.composer !== undefined ? (
        <ComposerView {...props} composer={props.composer} />
      ) : (
        <footer className="flex items-center gap-1 border-t border-dt-line px-3 py-2.5">
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
          <button type="button" className={ghost} disabled={q.at <= 0} onClick={props.onBack}>
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </button>
          <button
            type="button"
            className={primary}
            disabled={!forward && here === undefined}
            onClick={props.onNext}
          >
            Next
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        </footer>
      )}
      {props.toast.length > 0 && (
        <div className="absolute inset-x-3 bottom-[60px] flex animate-dt-arrive items-center gap-2 rounded-dt-control bg-dt-raised px-3 py-2 text-[13px] shadow-dt-float">
          <Check className="size-3.5 text-dt-good" aria-hidden />
          <span className="flex-1">
            {props.toast.length === 1 ? "Settled" : `${String(props.toast.length)} settled`}
          </span>
          <button type="button" className="text-dt-muted hover:text-dt-text" onClick={props.onUndo}>
            Undo
          </button>
        </div>
      )}
    </aside>
  );
}

function Header({ queue: q, eta }: PanelProps) {
  const count = left(q);
  const wait = waiting(q).length;
  const [help, setHelp] = useState(false);
  return (
    <header className="relative flex flex-col gap-1.5 px-4 pt-3.5 pb-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[13px] text-dt-muted">{JOURNEY}</span>
        <span className="text-[12px] text-dt-faint tabular-nums">
          {count === 0 ? "None left" : `${String(count)} left`}
        </span>
        <button
          type="button"
          aria-label="Keys"
          onClick={() => setHelp((h) => !h)}
          className="grid size-6 place-items-center rounded-full text-dt-faint hover:bg-dt-raised hover:text-dt-text"
        >
          ?
        </button>
      </div>
      {wait > 0 && (
        <span className="flex items-center gap-1.5 text-[12px] text-dt-muted">
          <LoaderCircle className="size-3 animate-spin text-dt-accent" aria-hidden />
          {wait === 1 ? "1 annotation" : `${String(wait)} annotations`} with the agent
          {eta !== undefined && <span className="text-dt-faint tabular-nums">· {eta} s</span>}
        </span>
      )}
      {help && <Keys />}
    </header>
  );
}

const KEYS = [
  ["j or →", "Next"],
  ["k or ←", "Back"],
  ["a", "Annotate what shows"],
  ["Alt+click", "Annotate any element"],
  ["1 to 9", "Pick a variant or an answer"],
  ["y", "Settle now and go on"],
  ["u", "Undo the last settle"],
] as const;

function Keys() {
  return (
    <dl className="absolute top-10 right-3 z-10 grid w-60 grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-dt-control bg-dt-raised p-3 text-[12px] shadow-dt-float">
      {KEYS.map(([key, what]) => (
        <div key={key} className="contents">
          <dt className="text-dt-faint">{key}</dt>
          <dd className="text-dt-text">{what}</dd>
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
    <section className="flex flex-col gap-3">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-dt-faint">
        <kind.Icon className="size-3.5" aria-hidden />
        {kind.label}
        <span className="flex-1" />
        {settled && (
          <span className="flex items-center gap-1 text-dt-good">
            <Check className="size-3.5" aria-hidden />
            Settled
          </span>
        )}
      </span>
      <h2 className="text-[15px] leading-5 font-semibold">{r.title}</h2>
      {r.kind === "answer" && <Asked queue={q} remark={r} />}
      {r.text !== undefined && <p className="text-[13px] leading-5 text-dt-muted">{r.text}</p>}
      {r.kind === "answer" && (
        <Changes
          block={{
            kind: "changes",
            items: [{ text: "The words", target: r.target, ...changeOf(targetOf(r.target)) }],
          }}
        />
      )}
      {r.variants !== undefined && (
        <Picks values={r.variants} picked={q.picks[r.id]} onPick={props.onPick} />
      )}
      {r.options !== undefined && (
        <Picks values={r.options} picked={q.picks[r.id]} onPick={props.onPick} />
      )}
      {mine.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-dt-line pt-3">
          {mine.map((a) => {
            const answered = answerOf(q, a.id) !== undefined;
            return (
              <li key={a.id} className="flex items-start gap-2 text-[13px] leading-5">
                {answered ? (
                  <Check className="mt-1 size-3.5 shrink-0 text-dt-good" aria-hidden />
                ) : (
                  <LoaderCircle
                    className="mt-1 size-3.5 shrink-0 animate-spin text-dt-accent"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">{a.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** What he wrote, which this answer answers. */
function Asked({ queue: q, remark: r }: { readonly queue: Queue; readonly remark: Remark }) {
  const asked = q.annotations.filter((a) => r.answers?.includes(a.id));
  return (
    <div className="flex flex-col gap-1 rounded-dt-control bg-dt-raised px-3 py-2 text-[13px] leading-5">
      <span className="text-[11px] font-medium text-dt-faint">You wrote</span>
      {asked.map((a) => (
        <span key={a.id}>{a.text}</span>
      ))}
    </div>
  );
}

function Picks({
  values,
  picked,
  onPick,
}: {
  readonly values: readonly string[];
  readonly picked: string | undefined;
  readonly onPick: (value: string) => void;
}) {
  return (
    <ol className="flex flex-col gap-1">
      {values.map((v, i) => (
        <li key={v}>
          <button
            type="button"
            onClick={() => onPick(v)}
            className={cx(
              "flex w-full items-center gap-2.5 rounded-dt-control px-2.5 py-2 text-left text-[13px]",
              picked === v ? "bg-dt-accent/15 text-dt-text" : "hover:bg-dt-raised",
            )}
          >
            <span
              className={cx(
                "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
                picked === v ? "bg-dt-accent text-white" : "bg-dt-raised text-dt-muted",
              )}
            >
              {i + 1}
            </span>
            <span className="flex-1">{v}</span>
            {picked === v && <Check className="size-3.5 text-dt-accent" aria-hidden />}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Nothing shows: before the first remark, or with all of them settled and answers to come. */
function Idle({ queue: q, eta }: { readonly queue: Queue; readonly eta: number | undefined }) {
  const open = order(q).length;
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="text-[15px] font-semibold">
        {open > 0 ? `${String(open)} remarks need you` : "Nothing needs you"}
      </span>
      {open === 0 && waiting(q).length > 0 && (
        <span className="text-[13px] text-dt-muted">
          The agent answers your annotations{eta !== undefined ? ` in about ${String(eta)} s` : ""}.
        </span>
      )}
    </section>
  );
}

/** At the end of the queue: why Next has nothing new. */
function Holding({ queue: q, eta }: { readonly queue: Queue; readonly eta: number | undefined }) {
  const hold = held(q).length;
  const wait = waiting(q).length;
  if (hold === 0 && wait === 0) return null;
  return (
    <p className="rounded-dt-control bg-dt-raised px-3 py-2 text-[12px] leading-5 text-dt-muted">
      {hold > 0
        ? `${String(hold)} more remarks come when the agent answers`
        : "The agent's answers come here"}
      {eta !== undefined ? `, in about ${String(eta)} s.` : "."}
    </p>
  );
}

function Shipping({
  ship,
  onStop,
}: {
  readonly ship: Ship | undefined;
  readonly onStop: () => void;
}) {
  const shipped = ship?.in === "shipped";
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
      <span
        className={cx(
          "grid size-10 place-items-center rounded-full",
          shipped ? "bg-dt-good/15 text-dt-good" : "bg-dt-accent/15 text-dt-accent",
        )}
      >
        {shipped ? (
          <Check className="size-5" aria-hidden />
        ) : (
          <Rocket className="size-5" aria-hidden />
        )}
      </span>
      <span className="text-[15px] font-semibold">{shipped ? "Merged" : "All settled"}</span>
      <span className="text-[13px] text-dt-muted">
        {shipped
          ? `${JOURNEY} is on main.`
          : `The agent ships ${JOURNEY} in ${String(ship?.in ?? 0)} s.`}
      </span>
      {!shipped && (
        <button type="button" className={ghost} onClick={onStop}>
          Stop
        </button>
      )}
    </section>
  );
}

function ComposerView(props: PanelProps & { readonly composer: Composer }) {
  const { composer } = props;
  return (
    <footer className="flex flex-col gap-2 border-t border-dt-line px-3 py-2.5">
      <span className="text-[11px] font-medium text-dt-faint">
        On {TARGETS[targetOf(composer.target)] ?? "the page"}
      </span>
      <textarea
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer opens to be written in
        autoFocus
        rows={2}
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
        className="resize-none rounded-dt-control bg-dt-raised px-2.5 py-2 text-[13px] leading-5 outline-none placeholder:text-dt-faint"
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
