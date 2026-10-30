import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import {
  annotate,
  annotationsOn,
  answerOf,
  arrive,
  back,
  current,
  done,
  isSettled,
  next,
  pick,
  settleNow,
  show,
  unsettle,
  waiting,
  type Move,
  type Queue,
} from "../../queue/queue";
import { cx } from "../../ui/cx";
import { Panel, type Composer, type Ship } from "./panel";
import { PAGES, answerTo, changeOf, selectorOf, start, targetOf, type Path } from "./script";
import { QueueStates } from "./queue-states";

/*
 * The queue prototype: a made-up app, the agent's remarks pinned on it, and one panel with
 * Next and Back. The agent is a script: it answers each annotation after a set delay, and
 * the page shows its change. The state survives a reload; Reset starts again.
 */

const KEY = "blueline.workshop.queue";

interface State {
  readonly queue: Queue;
  readonly delay: number;
  /** When the reviewer stopped the ship; a new settle starts it again. */
  readonly stopped: boolean;
}

const fresh = (limit = 2, delay = 8): State => ({
  queue: next(start(limit)).queue,
  delay,
  stopped: false,
});

function load(): State {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return typeof raw === "object" && raw !== null && "queue" in raw ? (raw as State) : fresh();
  } catch {
    return fresh();
  }
}

export function QueueWorkshop({ hash }: { readonly hash: string }) {
  return hash === "#queue/states" ? <QueueStates /> : <Live />;
}

function Live() {
  const [state, setState] = useState<State>(load);
  const [composer, setComposer] = useState<Composer | undefined>(undefined);
  const [toast, setToast] = useState<readonly string[]>([]);
  const [shipAt, setShipAt] = useState<number | undefined>(undefined);
  const [clock, setClock] = useState(Date.now());
  const q = state.queue;
  const here = current(q);
  const page: Path = (here?.page as Path | undefined) ?? "/request";

  useEffect(() => localStorage.setItem(KEY, JSON.stringify(state)), [state]);

  // The agent: an annotation's answer comes once its delay is over.
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const due = waiting(q).filter((a) => a.at + state.delay * 1000 <= clock);
    if (due.length === 0) return;
    setState((s) => ({
      ...s,
      queue: due.reduce((acc, a) => arrive(acc, answerTo(a, clock)), s.queue),
    }));
  }, [clock, q, state.delay]);
  const eta = waiting(q).reduce<number | undefined>((soonest, a) => {
    const s = Math.max(0, Math.ceil((a.at + state.delay * 1000 - clock) / 1000));
    return soonest === undefined ? s : Math.min(soonest, s);
  }, undefined);

  // The ship: ten seconds after the last settle, unless stopped.
  const finished = done(q) && !state.stopped;
  useEffect(() => setShipAt(finished ? Date.now() + 10_000 : undefined), [finished]);
  const ship: Ship | undefined =
    shipAt === undefined
      ? undefined
      : { in: clock >= shipAt ? "shipped" : Math.ceil((shipAt - clock) / 1000) };

  const move = (to: (q: Queue) => Move) => {
    const moved = to(q);
    if (moved.settled.length > 0) setToast(moved.settled);
    setState((s) => ({ ...s, queue: moved.queue, stopped: false }));
  };
  useEffect(() => {
    if (toast.length === 0) return;
    const id = setTimeout(() => setToast([]), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  const undo = () => {
    setState((s) => ({ ...s, queue: unsettle(s.queue, toast) }));
    setToast([]);
  };

  const open = (target: string) => setComposer({ target, text: "" });
  const send = () => {
    if (composer === undefined || composer.text.trim() === "") return;
    setState((s) => ({
      ...s,
      queue: annotate(s.queue, {
        id: `a${String(s.queue.annotations.length + 1)}`,
        page,
        target: composer.target,
        text: composer.text.trim(),
        on: current(s.queue)?.id,
        at: Date.now(),
      }),
    }));
    setComposer(undefined);
  };
  const choose = (value: string) => {
    if (here !== undefined) setState((s) => ({ ...s, queue: pick(s.queue, here.id, value) }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (composer !== undefined || e.metaKey || e.ctrlKey || e.altKey) return;
      const values = here?.variants ?? here?.options ?? [];
      const n = Number(e.key);
      if (e.key === "j" || e.key === "ArrowRight") move(next);
      else if (e.key === "k" || e.key === "ArrowLeft") move(back);
      else if (e.key === "y") move(settleNow);
      else if (e.key === "u" && toast.length > 0) undo();
      else if (e.key === "a" && here !== undefined) open(here.target);
      else if (n >= 1 && n <= values.length) choose(values[n - 1] ?? "");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Alt+click on an element of the app annotates it.
  const onPage = (e: React.MouseEvent) => {
    if (!e.altKey) return;
    const el = (e.target as Element).closest("[data-q]");
    if (el === null) return;
    e.preventDefault();
    open(selectorOf(el.getAttribute("data-q") ?? ""));
  };

  const changed = new Set(
    q.annotations.filter((a) => answerOf(q, a.id) !== undefined).map((a) => targetOf(a.target)),
  );

  return (
    <>
      <Controls
        state={state}
        setState={setState}
        reset={() => setState(fresh(q.limit, state.delay))}
      />
      <main
        onClickCapture={onPage}
        className="min-h-screen bg-[#fbfbfc] py-20 pr-[392px] pl-8 text-[#16161a]"
      >
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          <AppNav path={page} />
          <AppPage path={page} changed={changed} status={q.picks["r-status"] ?? "Dot"} />
        </div>
      </main>
      <Pins queue={q} page={page} onShow={(id) => move((s) => show(s, id))} />
      <Panel
        floating
        queue={q}
        eta={eta}
        composer={composer}
        toast={toast}
        ship={ship}
        onNext={() => move(next)}
        onBack={() => move(back)}
        onAnnotate={() => here !== undefined && open(here.target)}
        onWrite={(text) => setComposer((c) => (c === undefined ? c : { ...c, text }))}
        onSend={send}
        onCancel={() => setComposer(undefined)}
        onPick={choose}
        onUndo={undo}
        onStop={() => setState((s) => ({ ...s, stopped: true }))}
      />
    </>
  );
}

/** The workshop's own settings: how many annotations may wait, and how slow the agent is. */
function Controls({
  state,
  setState,
  reset,
}: {
  readonly state: State;
  readonly setState: (to: (s: State) => State) => void;
  readonly reset: () => void;
}) {
  const choice = (on: boolean) =>
    cx(
      "rounded-full px-2.5 py-1 tabular-nums",
      on ? "bg-dt-raised text-dt-text" : "text-dt-muted hover:text-dt-text",
    );
  return (
    <div className="blueline fixed bottom-3 left-3 z-[2147483004] flex items-center gap-3 rounded-full bg-dt-panel px-3 py-1.5 text-[12px] text-dt-muted shadow-dt-float">
      <span className="flex items-center gap-1">
        Waiting limit
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            className={choice(state.queue.limit === n)}
            onClick={() => setState((s) => ({ ...s, queue: { ...s.queue, limit: n } }))}
          >
            {n}
          </button>
        ))}
      </span>
      <span className="flex items-center gap-1">
        Agent
        {[3, 8, 30].map((n) => (
          <button
            key={n}
            type="button"
            className={choice(state.delay === n)}
            onClick={() => setState((s) => ({ ...s, delay: n }))}
          >
            {n} s
          </button>
        ))}
      </span>
      <a href="#queue/states" className="rounded-full px-2.5 py-1 hover:text-dt-text">
        States
      </a>
      <button type="button" className="rounded-full px-2.5 py-1 hover:text-dt-text" onClick={reset}>
        Reset
      </button>
    </div>
  );
}

/** A numbered mark at each open remark on the page, and at each annotation that waits. The
 * remark that shows has a frame. */
function Pins({
  queue: q,
  page,
  onShow,
}: {
  readonly queue: Queue;
  readonly page: string;
  readonly onShow: (id: string) => void;
}) {
  const [, redraw] = useState(0);
  useLayoutEffect(() => {
    const again = () => redraw((n) => (n + 1) % 1024);
    again();
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
  }, [page, q]);
  const here = current(q);
  const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
  const frame = here === undefined ? undefined : box(here.target);
  const remarks = q.remarks.filter(
    (r) => r.page === page && (!isSettled(q, r.id) || r.id === here?.id) && r.kind !== "answer",
  );
  const mine = waiting(q).filter((a) => a.page === page);
  // Two marks on one element sit side by side.
  const taken = new Map<string, number>();
  const slot = (selector: string) => {
    const n = taken.get(selector) ?? 0;
    taken.set(selector, n + 1);
    return n;
  };
  return (
    <div className="blueline pointer-events-none fixed inset-0 z-[2147483001]">
      {frame !== undefined && (
        <span
          className="absolute rounded-[10px] ring-2 ring-dt-accent transition-all duration-200"
          style={{
            left: frame.x - 6,
            top: frame.y - 6,
            width: frame.width + 12,
            height: frame.height + 12,
          }}
        />
      )}
      {remarks.map((r) => {
        const rect = box(r.target);
        if (rect === undefined) return null;
        const n = q.remarks.filter((x) => x.kind !== "answer").indexOf(r) + 1;
        const at = slot(r.target);
        return (
          <button
            key={r.id}
            type="button"
            aria-label={`Remark ${String(n)}: ${r.title}`}
            onClick={() => onShow(r.id)}
            className={cx(
              "pointer-events-auto absolute grid size-5 -translate-y-1/2 place-items-center rounded-[6px] text-[10px] font-semibold tabular-nums shadow-dt-float transition-transform hover:scale-110",
              r.id === here?.id ? "scale-110 bg-dt-accent text-white" : "bg-dt-panel text-dt-text",
              annotationsOn(q, r.id).length > 0 && r.id !== here?.id && "opacity-50",
            )}
            style={{ left: rect.right + 10 + at * 24, top: rect.top }}
          >
            {n}
          </button>
        );
      })}
      {mine.map((a) => {
        const rect = box(a.target);
        if (rect === undefined) return null;
        const at = slot(a.target);
        return (
          <span
            key={a.id}
            title={a.text}
            className="absolute grid size-5 -translate-y-1/2 animate-pulse place-items-center rounded-full bg-dt-text text-[10px] font-semibold text-dt-ground shadow-dt-float"
            style={{ left: rect.right + 10 + at * 24, top: rect.top }}
          >
            ✎
          </span>
        );
      })}
    </div>
  );
}

function AppNav({ path }: { readonly path: Path }) {
  return (
    <nav className="flex gap-1 text-[13px]">
      {PAGES.map((p) => (
        <span
          key={p.path}
          className={
            p.path === path
              ? "rounded-md bg-[#e8edff] px-3 py-1.5 font-medium text-[#3550c8]"
              : "rounded-md px-3 py-1.5 text-[#5b5b66]"
          }
        >
          {p.title}
        </span>
      ))}
    </nav>
  );
}

const card =
  "flex flex-col gap-6 rounded-xl border border-[#e4e4e9] bg-white p-8 [&_h1]:text-[24px] [&_h1]:font-semibold";

/** The made-up app. An element that the agent changed shows its new words. */
function AppPage({
  path,
  changed,
  status,
}: {
  readonly path: Path;
  readonly changed: ReadonlySet<string>;
  readonly status: string;
}) {
  const words = (target: string) => {
    const change = changeOf(target);
    return changed.has(target) ? change.after : change.before;
  };
  if (path === "/approvers")
    return (
      <section className={card}>
        <h1>Approvers</h1>
        <div data-q="approver-list" className="flex flex-col gap-2">
          {APPROVERS.map((a, i) => (
            <div
              key={a.name}
              className="flex items-center justify-between rounded-md bg-[#f1f1f4] px-3 py-2 text-[14px]"
            >
              <span className="flex items-center gap-2">
                <span className="text-[#8a8a94]">⠿</span>
                <span className="text-[12px] text-[#8a8a94] tabular-nums">{i + 1}</span>
                <span className="font-medium">{a.name}</span>
              </span>
              <span className="text-[#5b5b66]">
                {i === 0 && changed.has("approver-list") ? words("approver-list") : a.role}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          data-q="add"
          className="self-start rounded-md border border-[#dcdce3] px-3 py-1.5 text-[13px] font-medium"
        >
          {words("add")}
        </button>
      </section>
    );
  if (path === "/sent")
    return (
      <section className={card}>
        <h1>Sent for approval</h1>
        <p data-q="sent" className="text-[14px] text-[#5b5b66]">
          {words("sent")} Ingrid Berg gets it once Ola Hansen approves.
        </p>
      </section>
    );
  return (
    <section className={card}>
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium tracking-wide text-[#8a8a94] uppercase">
          A made-up page
        </span>
        <div data-q="title" className="flex flex-col gap-1">
          <h1>{words("title")}</h1>
          <span className="text-[13px] text-[#5b5b66]">Asked by Ola Hansen · 2 days ago</span>
        </div>
        <span data-q="status" className="w-fit">
          <Status look={status} text={changed.has("status") ? words("status") : "In review"} />
        </span>
      </div>
      <label data-q="amount" className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium">Amount</span>
        <input
          name="amount"
          value={words("amount")}
          readOnly
          className="rounded-md border border-[#dcdce3] px-3 py-2 text-[14px] tabular-nums"
        />
      </label>
      <div data-q="approvers" className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Approvers</span>
        {APPROVERS.map((a) => (
          <div
            key={a.name}
            className="flex justify-between rounded-md bg-[#f1f1f4] px-3 py-2 text-[14px]"
          >
            <span className="font-medium">{a.name}</span>
            <span className="text-[#5b5b66]">{a.role}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        data-q="submit"
        className="self-end rounded-md bg-[#4a6cf7] px-4 py-2 text-[14px] font-medium text-white"
      >
        {words("submit")}
      </button>
    </section>
  );
}

const APPROVERS = [
  { name: "Ola Hansen", role: "Director" },
  { name: "Ingrid Berg", role: "Finance" },
] as const;

function Status({ look, text }: { readonly look: string; readonly text: string }): ReactNode {
  if (look === "Pill")
    return (
      <span className="rounded-full bg-[#e8edff] px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap text-[#3550c8]">
        {text}
      </span>
    );
  if (look === "Steps")
    return (
      <span className="flex items-center gap-1 text-[12px] whitespace-nowrap text-[#5b5b66]">
        <span className="h-1 w-6 rounded-full bg-[#4a6cf7]" />
        <span className="h-1 w-6 rounded-full bg-[#4a6cf7]" />
        <span className="h-1 w-6 rounded-full bg-[#dcdce3]" />
        <span className="ml-1">{text}</span>
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-[13px] whitespace-nowrap text-[#5b5b66]">
      <span className="size-2 rounded-full bg-[#4a6cf7]" />
      {text}
    </span>
  );
}
