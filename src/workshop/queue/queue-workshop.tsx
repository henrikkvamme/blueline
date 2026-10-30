import { useEffect, useLayoutEffect, useState } from "react";
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
  type Remark,
} from "../../queue/queue";
import { CornerDownRight, PenLine } from "lucide-react";
import { cx } from "../../ui/cx";
import { PANEL } from "../../ui/geometry";
import { Panel, SHIP_SECONDS, type Composer, type Ship } from "./panel";
import { AppNav, AppPage, Status } from "./app";
import { answerTo, selectorOf, start, targetOf, type Path } from "./script";
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
  useEffect(() => setShipAt(finished ? Date.now() + SHIP_SECONDS * 1000 : undefined), [finished]);
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
        // The page narrows by the panel's width, so the panel covers nothing.
        style={{ marginRight: PANEL }}
        className="min-h-screen bg-[#fbfbfc] px-8 py-20 text-[#16161a]"
      >
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          <AppNav path={page} />
          <AppPage path={page} changed={changed} status={q.picks["r-status"] ?? "Dot"} />
        </div>
      </main>
      <Pins queue={q} page={page} onShow={(id) => move((s) => show(s, id))} />
      <Panel
        docked
        preview={(_, v) => <Status look={v} text="In review" />}
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

/** The light round the remark that shows, with its number on a tab, and a mark at each other
 * open remark on the page and at each annotation with the agent. */
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
  const frame = here === undefined || here.page !== page ? undefined : box(here.target);
  const numbered = q.remarks.filter((r) => r.kind !== "answer");
  const numberOf = (r: Remark) =>
    numbered.indexOf(
      r.kind === "answer"
        ? (numbered.find((x) =>
            r.answers?.some((a) => annotationsOn(q, x.id).some((m) => m.id === a)),
          ) ?? r)
        : r,
    ) + 1;
  const others = numbered.filter(
    (r) => r.page === page && !isSettled(q, r.id) && r.id !== here?.id && r.target !== here?.target,
  );
  const mine = waiting(q).filter((a) => a.page === page);
  // Marks on one element stand side by side.
  // The light's tab takes the first place on its element.
  const taken = new Map<string, number>(
    frame !== undefined && here !== undefined ? [[here.target, 1]] : [],
  );
  const slot = (selector: string) => {
    const n = taken.get(selector) ?? 0;
    taken.set(selector, n + 1);
    return n;
  };
  const answer = here?.kind === "answer";
  return (
    <div className="blueline pointer-events-none fixed inset-0 z-[2147483001]">
      {frame !== undefined && here !== undefined && (
        <span
          className={cx(
            "absolute rounded-[12px] ring-2 transition-[left,top,width,height] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]",
            answer
              ? "shadow-[0_0_0_6px_rgb(63_178_127/0.14)] ring-dt-good"
              : "shadow-[0_0_0_6px_rgb(74_108_247/0.14)] ring-dt-accent",
          )}
          style={{
            left: frame.x - 8,
            top: frame.y - 8,
            width: frame.width + 16,
            height: frame.height + 16,
          }}
        >
          <span
            className={cx(
              "absolute top-0 left-[calc(100%+8px)] grid h-5 min-w-5 animate-dt-arrive place-items-center rounded-[6px] px-1 text-[10px] font-semibold text-white tabular-nums shadow-dt-float",
              answer ? "bg-dt-good" : "bg-dt-accent",
            )}
          >
            {answer ? <CornerDownRight className="size-3" aria-hidden /> : numberOf(here)}
          </span>
        </span>
      )}
      {others.map((r) => {
        const rect = box(r.target);
        if (rect === undefined) return null;
        const at = slot(r.target);
        const asked = annotationsOn(q, r.id).length > 0;
        return (
          <button
            key={r.id}
            type="button"
            aria-label={`Remark ${String(numberOf(r))}: ${r.title}`}
            title={r.title}
            onClick={() => onShow(r.id)}
            className={cx(
              "pointer-events-auto absolute grid h-5 min-w-5 -translate-y-1/2 animate-dt-fade place-items-center rounded-[6px] bg-dt-panel px-1 text-[10px] font-semibold text-dt-muted tabular-nums shadow-dt-float transition-[scale,color] hover:scale-110 hover:text-dt-text",
              asked && "opacity-45",
            )}
            style={{ left: rect.right + 16 + at * 26, top: rect.top + 2 }}
          >
            {numberOf(r)}
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
            className="absolute grid size-5 -translate-y-1/2 animate-dt-fade place-items-center rounded-full bg-dt-text text-dt-ground shadow-dt-float"
            style={{ left: rect.right + 16 + at * 26, top: rect.top + 2 }}
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-dt-text/30" />
            <PenLine className="relative size-2.5" aria-hidden />
          </span>
        );
      })}
    </div>
  );
}
