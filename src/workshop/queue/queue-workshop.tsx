import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ahead,
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
  remarkOf,
  show,
  waiting,
  type Beat,
  type Place,
  placeOf,
  withPlace,
  isTried,
  settleOne,
  walked,
  type Moment,
  type Move,
  type Queue,
  type Remark,
  settleNow,
  type Drawn,
  type Pointed,
} from "../../queue/queue";
import { CornerDownRight, PenLine } from "lucide-react";
import { cx } from "../../ui/cx";
import { PANEL } from "../../ui/geometry";
import { Panel, SHIP_SECONDS, type Composer, type Ship } from "./panel";
import { AppNav, AppPage, Board } from "./app";
import { Guide, GuideToggle } from "./guide";
import { VOICES } from "./voice";
import { Walker, type Preview } from "./walker";
import { Strokes, TalkView, usePointAndTalk, type FastEars, type Trail } from "./talk";
import { fast, type Call } from "./realtime";
import { answerTo, heard, PAGES, selectorOf, start, targetOf, type Path } from "./script";
import { ask, elements, forget, played } from "./agent";
import { perform, type Act, type Shows } from "./acts";
import { DesignPreview, Designs, type Shown } from "./design";
import * as timing from "./timing";
import { QueueStates } from "./queue-states";

/*
 * The queue prototype: a made-up app, the agent's remarks pinned on it, and one panel with
 * Next and Back. The agent's remarks and its answers to annotations come from a script, after
 * a set delay. What he says with point and talk goes to a real agent when the dev server has
 * one: it answers on the page with the cursor, and puts changes in the queue. The state
 * survives a reload; Reset starts again.
 */

const KEY = "blueline.workshop.queue.4";
const GUIDE = "blueline.workshop.queue.guide";

interface State {
  readonly queue: Queue;
  readonly delay: number;
  /** When the reviewer stopped the ship; a new settle starts it again. */
  readonly stopped: boolean;
}

const fresh = (delay = 8): State => ({
  queue: next(start()).queue,
  delay,
  stopped: false,
});

/** One exchange of point and talk: what he said, and how far the agent's answer is. */
interface Exchange {
  readonly said: string;
  /** What the fast model heard him ask for, before the agent answers. */
  readonly heard: string | undefined;
  /** Whether he says the answer was wrong, and whether that was kept as a case. */
  readonly wrong?: "asking" | "saving" | "saved" | "failed" | undefined;
  readonly tone: "busy" | "showing" | "done" | "failed";
  /** What the agent does now, or its last words. */
  readonly status: string;
  /** The walk it showed last, to show again. */
  readonly walk: readonly Beat[] | undefined;
  /** The annotation it put in the queue, whose answer comes later. */
  readonly annotation: string | undefined;
}

interface GuideSettings {
  /** Whether each remark walks when it shows. */
  readonly on: boolean;
  readonly voice: boolean;
  /** The OpenAI voice that speaks. */
  readonly speaker: string;
  readonly reduced: boolean;
}

function loadGuide(): GuideSettings {
  const start = {
    on: true,
    voice: true,
    speaker: VOICES[0].id,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(GUIDE) ?? "null");
    const kept: GuideSettings =
      typeof raw === "object" && raw !== null ? { ...start, ...raw } : start;
    // A voice from before OpenAI's took over is gone: the first one speaks.
    return VOICES.some((v) => v.id === kept.speaker) ? kept : { ...kept, speaker: start.speaker };
  } catch {
    return start;
  }
}

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
  const [leftOpen, setLeftOpen] = useState<string | undefined>(undefined);
  const [shipAt, setShipAt] = useState<number | undefined>(undefined);
  const [clock, setClock] = useState(Date.now());
  const [tree, setTree] = useState(false);
  const [guide, setGuide] = useState<GuideSettings>(loadGuide);
  // A variant that shows on the page and is not kept: the reviewer's own preview, and the
  // guide's while a beat shows it.
  const [peek, setPeek] = useState<string | undefined>(undefined);
  // The state that the part shows, of a choice's states; none for the page's own.
  const [shown, setShown] = useState<string | undefined>(undefined);
  // An answer's element as it was, while he holds b or hovers Was.
  const [before, setBefore] = useState(false);
  const [guidePeek, setGuidePeek] = useState<Preview | undefined>(undefined);
  // A page of the app that he, or the agent's cursor, went to by a click, on that remark. It
  // ends with the remark in the same render, so a new remark's walk starts on its own page.
  const [visit, setVisit] = useState<{ readonly id: string | undefined; readonly path: Path }>();
  const [exchange, setExchange] = useState<Exchange | undefined>(undefined);
  const asking = useRef<AbortController | undefined>(undefined);
  // In state, not a memo, so a hot update of this file keeps the walk that plays.
  const [walker] = useState(
    () =>
      new Walker(
        () => ({ width: window.innerWidth - PANEL, height: window.innerHeight }),
        setGuidePeek,
      ),
  );
  const walk = useSyncExternalStore(walker.subscribe, walker.snapshot);
  useEffect(() => localStorage.setItem(GUIDE, JSON.stringify(guide)), [guide]);
  useEffect(
    () =>
      walker.configure({
        voice: guide.voice ? guide.speaker : undefined,
        reduced: guide.reduced,
      }),
    [walker, guide],
  );
  const q = state.queue;
  const here = current(q);
  const page: Path =
    visit !== undefined && visit.id === here?.id
      ? visit.path
      : ((here?.page as Path | undefined) ?? "/request");
  const pageNow = useRef(page);
  pageNow.current = page;
  const remarkRun = useRef<{ readonly run: number; readonly id: string } | undefined>(undefined);
  const walkRemark = (id: string, beats: readonly Beat[], path: string) => {
    walker.start(beats, path);
    remarkRun.current = { run: walker.snapshot().run, id };
  };
  useEffect(() => {
    const off = walker.subscribe(() => {
      const snap = walker.snapshot();
      const mine = remarkRun.current;
      if (snap.phase !== "done" || snap.skipped || mine?.run !== snap.run) return;
      remarkRun.current = undefined;
      setState((s) => ({ ...s, queue: walked(s.queue, mine.id) }));
    });
    return () => {
      off();
    };
  }, [walker]);
  // Each remark walks when it shows, with walks on; its preview ends when it goes.
  useEffect(() => {
    setPeek(undefined);
    setShown(undefined);
    setBefore(false);
    setVisit(undefined);
    if (guide.on && here?.walk !== undefined && !isTried(q, here))
      walkRemark(here.id, here.walk, here.page);
    else {
      walker.stop();
      const read = here?.id;
      if (!guide.on && read !== undefined)
        setState((s) => ({ ...s, queue: walked(s.queue, read) }));
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new remark starts a walk, not a new setting
  }, [here?.id, walker]);
  useEffect(() => walker.navigate(page), [walker, page]);
  // For the answer evals: where the walk is, and what it waits for him to click.
  useEffect(() => {
    const root = document.documentElement.dataset;
    root["walk"] = walk.phase;
    root["walkTurn"] = walker.turnTarget() ?? "";
  }, [walker, walk]);
  /** A variant that the agent designed as markup, by its remark and name. */
  const designOf = (id: string, value: string) => remarkOf(q, id)?.designs?.[value];
  // The designs that show on this page: the one he or the guide previews on the remark that
  // shows, and those he kept.
  const designs: readonly Shown[] = q.remarks.flatMap((r) => {
    const previewed = r.id === here?.id ? (peek ?? guidePeek?.variant) : undefined;
    const value = previewed ?? q.picks[r.id];
    const html = value === undefined ? undefined : r.designs?.[value];
    if (html === undefined || r.page !== page) return [];
    const state = (r.id === here?.id ? (shown ?? guidePeek?.state) : undefined) ?? r.states?.[0];
    return [{ target: r.target, html, state: state ?? "" }];
  });
  /** g: pause a walk, go on with it, or walk the remark again. */
  const toggleWalk = () => {
    if (walker.active()) walker.pause();
    else if (walk.phase === "paused" || walk.phase === "lost") walker.resume();
    else if (here?.walk !== undefined) walkRemark(here.id, here.walk, page);
  };

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

  const past = useRef<readonly Place[]>([]);
  const future = useRef<readonly Place[]>([]);
  const remember = () => {
    past.current = [...past.current.slice(-49), placeOf(q)];
    future.current = [];
  };
  const travel = (from: { current: readonly Place[] }, to: { current: readonly Place[] }) => {
    const place = from.current.at(-1);
    if (place === undefined) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, placeOf(q)];
    setToast([]);
    setLeftOpen(undefined);
    setState((s) => ({ ...s, queue: withPlace(s.queue, place), stopped: false }));
  };
  const undo = () => travel(past, future);
  const redo = () => travel(future, past);
  const move = (to: (q: Queue) => Move) => {
    const moved = to(q);
    if (moved.queue !== q) remember();
    // An exchange that is over goes with the remark; one whose change is still coming stays.
    const open =
      exchange?.annotation !== undefined && answerOf(q, exchange.annotation) === undefined;
    if (exchange !== undefined && exchange.tone !== "busy" && !open) setExchange(undefined);
    if (moved.settled.length > 0) setToast(moved.settled);
    setLeftOpen(moved.untried);
    setState((s) => ({ ...s, queue: moved.queue, stopped: false }));
  };
  useEffect(() => {
    if (leftOpen === undefined) return;
    const id = setTimeout(() => setLeftOpen(undefined), 5000);
    return () => clearTimeout(id);
  }, [leftOpen]);
  const settleOpen = () => {
    if (leftOpen === undefined) return;
    const moved = settleOne(q, leftOpen);
    remember();
    setToast(moved.settled);
    setLeftOpen(undefined);
    setState((s) => ({ ...s, queue: moved.queue }));
  };
  useEffect(() => {
    if (toast.length === 0) return;
    lastSettled.current = toast;
    const id = setTimeout(() => setToast([]), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  // The agent's acts come after the words that asked for them, so they read the queue now.
  const lastSettled = useRef<readonly string[]>([]);
  const queueNow = useRef(q);
  queueNow.current = q;
  const go = (path: Path) => setVisit({ id: current(queueNow.current)?.id, path });

  /** What only shows of the agent's acts, as his keys would show it. */
  const showAct = (act: Shows, queue: Queue) => {
    switch (act.do) {
      case "preview":
        if (act.variant !== undefined) setPeek(act.variant ?? undefined);
        if (act.state !== undefined) setShown(act.state ?? undefined);
        break;
      case "go": {
        const to = PAGES.find((p) => p.path === act.page || p.title === act.page);
        if (to !== undefined) go(to.path);
        break;
      }
      case "seen":
        setTree(act.open);
        break;
      case "settings": {
        const speaker = VOICES.find((v) => v.id === act.speaker || v.name === act.speaker);
        setGuide((g) => ({
          ...g,
          ...(act.voice === undefined ? {} : { voice: act.voice }),
          ...(act.walks === undefined ? {} : { on: act.walks }),
          ...(act.lessMotion === undefined ? {} : { reduced: act.lessMotion }),
          ...(speaker === undefined ? {} : { speaker: speaker.id }),
        }));
        if (act.delay !== undefined) {
          const delay = Math.max(0, act.delay);
          setState((s) => ({ ...s, delay }));
        }
        break;
      }
      case "walk": {
        const r = current(queue);
        if (r?.walk !== undefined) walkRemark(r.id, r.walk, r.page);
        break;
      }
      case "stopShip":
        setState((s) => ({ ...s, stopped: true }));
        break;
    }
  };

  /** Does the agent's acts, in order, and tells it what each did and where the review is. */
  const act = (id: string, acts: readonly Act[]) => {
    const from = queueNow.current;
    const did = perform(from, lastSettled.current, acts, Date.now());
    if (did.queue !== from) {
      past.current = [...past.current.slice(-49), placeOf(from)];
      future.current = [];
      queueNow.current = did.queue;
      setState((s) => ({ ...s, queue: did.queue, stopped: false }));
    }
    lastSettled.current = did.toast;
    if (did.toast.length > 0 && did.toast !== toast) setToast(did.toast);
    // A variant it designs for the remark that shows, shows at once, as his preview would.
    const here_ = current(did.queue)?.id;
    const designed = acts
      .flatMap((a) => (a.do === "addVariants" && a.remark === here_ ? a.variants : []))
      .at(-1)?.name;
    // A new remark clears what showed of the last one, so what only shows comes after it.
    window.setTimeout(() => {
      if (designed !== undefined) setPeek(designed);
      for (const shows of did.shows) showAct(shows, did.queue);
      window.setTimeout(() => {
        const now = current(did.queue);
        played(
          id,
          `${did.said.join("; ")}. The review now shows ${now === undefined ? "no remark" : `“${now.title}” (${now.id})`}.`,
          pageNow.current,
        );
      }, 150);
    }, 60);
  };

  /** What shows now, for the agent to see what he saw: the variant and the state of the
   * part, and the line the agent's cursor says, if it speaks. */
  const momentNow = (): Moment => {
    const snap = walker.snapshot();
    return {
      variant: here?.kind === "choice" ? (peek ?? guidePeek?.variant) : undefined,
      state: shown ?? guidePeek?.state,
      over: walker.active() ? here?.walk?.[snap.beat]?.say : undefined,
    };
  };
  const moment = useRef<Moment>({});
  /** Tells the agent how its walk went, once it ends, stops or waits. */
  const watch = (id: string) => {
    const run = walker.snapshot().run;
    const off = walker.subscribe(() => {
      const { phase, beat, note } = walker.snapshot();
      const at = String(beat + 1);
      const how =
        walker.snapshot().run !== run
          ? "Another walk took its place: a remark or an answer came."
          : phase === "done"
            ? "He watched it to the end."
            : phase === "paused"
              ? `He paused it at beat ${at}, maybe to speak.`
              : phase === "idle"
                ? `He stopped it at beat ${at}.`
                : phase === "lost"
                  ? `It lost its element at beat ${at}: ${note?.line ?? ""}`
                  : undefined;
      if (how === undefined) return;
      off();
      // The page draws what the last click changed before it is measured.
      window.setTimeout(() => played(id, how, pageNow.current), 120);
    });
  };

  // Point and talk: ⌃⌘ held, or ⌃⌃ to type, stops the walk. His words go to the agent, with what he pointed
  // at and what the page shows, and the agent answers on the page with its cursor. With no
  // agent, the script puts his words in the queue and says it is on it.
  // The fast tier (ADR 0008): the realtime model hears him and calls these tools at once.
  const fastCalls = useRef<{
    onCall: (c: Call) => void;
    onHeard: (w: string, turn: number) => void;
  }>({
    onCall: () => undefined,
    onHeard: () => undefined,
  });
  const speakerNow = useRef(guide.speaker);
  speakerNow.current = guide.speaker;
  const [realtime] = useState(() =>
    fast(() => speakerNow.current, {
      onCall: (c) => fastCalls.current.onCall(c),
      onHeard: (w, turn) => fastCalls.current.onHeard(w, turn),
    }),
  );
  // A hot update runs the cleanup and the effect again at once: only a real unmount ends
  // the walk and the session.
  const parting = useRef(0);
  useEffect(() => {
    window.clearTimeout(parting.current);
    realtime.warm();
    return () => {
      parting.current = window.setTimeout(() => {
        walker.destroy();
        realtime.close();
      });
    };
  }, [walker, realtime]);
  useEffect(() => realtime.mute(!guide.voice), [realtime, guide.voice]);
  // Its voice is fixed once it has spoken, so a new voice needs a new session.
  const sessionVoice = useRef(guide.speaker);
  useEffect(() => {
    if (sessionVoice.current === guide.speaker) return;
    sessionVoice.current = guide.speaker;
    realtime.close();
    realtime.warm();
  }, [realtime, guide.speaker]);
  /** What he pointed at and said in each turn, by the turn the fast tier gave it. */
  const holds = useRef(
    new Map<
      number,
      {
        readonly target: string | undefined;
        readonly trail: Trail;
        readonly drawn: readonly Drawn[];
        readonly at: { readonly x: number; readonly y: number };
        heard: string | undefined;
      }
    >(),
  );

  /** The page as he sees it, for the fast tier, in a few lines. */
  const pageFor = (said: { readonly trail: Trail; readonly drawn: readonly Drawn[] }) => {
    const seen = elements();
    const nameOf = (selector: string) =>
      seen.find((e) => e.selector === selector)?.name ?? selector;
    const values = here?.variants ?? here?.options ?? [];
    const kept = here === undefined ? undefined : q.picks[here.id];
    const pointedAt = said.trail.flatMap((t) =>
      t.target === undefined ? [] : [`${nameOf(t.target)} ${t.target}`],
    );
    const circled = said.drawn.flatMap((d) => (d.target === undefined ? [] : [nameOf(d.target)]));
    return [
      `The page: ${page}.`,
      here === undefined
        ? "No remark is open."
        : `The open remark: “${here.title}”, a ${here.kind}. ${here.text ?? ""}`,
      values.length === 0
        ? ""
        : `Its ${here?.variants === undefined ? "options" : "variants"}: ${values.map((v, i) => `${String(i + 1)} “${v}”`).join(", ")}.`,
      kept === undefined ? "" : `Kept: “${kept}”.`,
      peek === undefined ? "" : `Shown now: “${peek}”.`,
      `He pointed at, while he spoke: ${pointedAt.length === 0 ? "nothing" : pointedAt.join(", then ")}.`,
      circled.length === 0 ? "" : `He circled: ${circled.join(", ")}.`,
      `Parts of the page: ${seen.map((e) => `${e.name ?? e.text.slice(0, 40)} ${e.selector}`).join("; ")}.`,
      `Remarks after this one: ${String(ahead(q).length)}.`,
    ]
      .filter((line) => line !== "")
      .join("\n");
  };

  const fastEars: FastEars = {
    ready: () => {
      if (realtime.ready()) return true;
      console.warn("Realtime: not ready, so the old ears hear this");
      realtime.warm();
      return false;
    },
    press: (stream) => realtime.press(stream),
    drop: () => realtime.drop(),
    release: (said) => {
      const text = pageFor(said);
      timing.asked({ fast: text });
      timing.mark("sent");
      const { turn, answered } = realtime.release(text);
      holds.current.set(turn, { ...said, heard: undefined });
      holds.current.delete(turn - 8);
      return answered;
    },
  };

  /** What the fast tier asked for, done as his own keys would do it. */
  const runCall = (call: Call) => {
    timing.mark("heard");
    timing.mark("agent");
    timing.note({ line: `${call.name} ${JSON.stringify(call.args)}`, ear: "gpt-realtime-2.1" });
    const held = holds.current.get(call.turn);
    const values = here?.variants ?? here?.options ?? [];
    const nth = (n: unknown) => (typeof n === "number" ? values[n - 1] : undefined);
    const titleAfter = (to: (x: Queue) => Move) =>
      current(to(q).queue)?.title ?? "nothing left to see";
    if (call.name !== "ask_deep_agent") asking.current?.abort();
    let did: string;
    switch (call.name) {
      case "next":
        did = `Next: “${titleAfter(next)}”`;
        move(next);
        break;
      case "back":
        did = `Back: “${titleAfter(back)}”`;
        move(back);
        break;
      case "settle":
        did = here === undefined ? "Nothing to settle" : `Settled “${here.title}”`;
        move(settleNow);
        break;
      case "undo":
        did = "Undone";
        undo();
        break;
      case "preview": {
        const value = nth(call.args["n"]);
        did = value === undefined ? "No such option" : `Showing “${value}”`;
        if (value !== undefined) setPeek(value);
        break;
      }
      case "keep": {
        const value = nth(call.args["n"]) ?? peek;
        did = value === undefined ? "Nothing to keep" : `Kept “${value}”`;
        if (value !== undefined) choose(value);
        break;
      }
      case "point": {
        const asked = call.args["target"];
        const wanted = typeof asked === "string" ? asked : "";
        const found = elements().find(
          (e) => e.selector === wanted || e.name === wanted || e.text.includes(wanted),
        );
        did =
          found === undefined
            ? `No “${wanted}” on the page`
            : `Pointing at ${found.name ?? wanted}`;
        if (found !== undefined) walker.hold(found.selector, found.name ?? wanted);
        break;
      }
      case "play":
        did = "Playing the walk";
        if (walk.phase === "paused" || walk.phase === "lost") walker.resume();
        else if (here?.walk !== undefined) walkRemark(here.id, here.walk, page);
        break;
      case "pause":
        did = "Paused";
        walker.pause();
        break;
      case "ask_deep_agent": {
        const asked = call.args["request"];
        const request = typeof asked === "string" && asked !== "" ? asked : (held?.heard ?? "");
        const on = held?.target;
        askAgent(
          on,
          request,
          on === undefined ? [] : [{ target: on, words: request }],
          held?.drawn ?? [],
          held?.at ?? { x: innerWidth / 2, y: innerHeight / 2 },
          (words) => realtime.tell(`The deep agent answered on the page: ${words}`),
          { by: "gpt-realtime-2.1", deep: call.args["depth"] === "deep" },
        );
        realtime.answer(
          call.id,
          "The deep agent has it and answers on the page itself. Do not answer for it.",
        );
        return;
      }
      default:
        did = `No tool ${call.name}`;
    }
    realtime.answer(call.id, did);
    setExchange({
      said: held?.heard ?? "",
      heard: undefined,
      tone: "done",
      status: did,
      walk: undefined,
      annotation: undefined,
    });
  };
  fastCalls.current = {
    onCall: runCall,
    onHeard: (words, turn) => {
      const held = holds.current.get(turn);
      if (held !== undefined) held.heard = words;
      timing.note({ said: words });
      setExchange((x) => (x !== undefined && x.said === "" ? { ...x, said: words } : x));
    },
  };

  /** His words go to the deep agent, and it answers on the page; `done` gets its last words. */
  const askAgent = (
    spoken: string | undefined,
    text: string,
    pointed: readonly Pointed[],
    drawn: readonly Drawn[],
    at: { readonly x: number; readonly y: number },
    done?: (words: string) => void,
    via?: { readonly by: string; readonly deep: boolean },
  ) => {
    {
      const target = spoken ?? here?.target ?? selectorOf("title");
      const seenThen = moment.current;
      const note = (on: string, words: string) => {
        const id = `a${Date.now().toString(36)}`;
        setState((s) => ({
          ...s,
          queue: annotate(s.queue, {
            id,
            page,
            target: on,
            text: words,
            on: current(s.queue)?.id,
            at: Date.now(),
            pointed,
            drawn,
            moment: seenThen,
          }),
        }));
        return id;
      };
      asking.current?.abort();
      const control = new AbortController();
      asking.current = control;
      const update = (to: (x: Exchange) => Exchange) => {
        if (asking.current === control) setExchange((x) => (x === undefined ? x : to(x)));
      };
      setExchange({
        said: text,
        heard: undefined,
        tone: "busy",
        status: "Thinking",
        walk: undefined,
        annotation: undefined,
      });
      walker.from({ x: at.x + 16, y: at.y + 14 });
      walker.hold(target, `“${text}”`);
      const context = {
        ...(via === undefined ? {} : { heardBy: via.by }),
        ...(via?.deep === true ? { effort: "medium" } : {}),
        said: text,
        pointedWhileSaying: pointed,
        circled: drawn.flatMap((d) => (d.target === undefined ? [] : [d.target])),
        mouse: [Math.round(at.x), Math.round(at.y)],
        page,
        pages: PAGES,
        remark:
          here === undefined
            ? undefined
            : {
                id: here.id,
                kind: here.kind,
                title: here.title,
                text: here.text,
                variants: here.variants,
                options: here.options,
                states: here.states,
                kept: q.picks[here.id],
                walk: here.walk?.map((b) => b.say),
              },
        shownWhenHeSpoke: seenThen,
        queueAhead: ahead(q).map((a) =>
          a.kind === "remark" ? a.remark.title : "the agent's answer to an annotation",
        ),
        viewport: [innerWidth, innerHeight],
        panelWidth: PANEL,
        elements: elements(),
      };
      timing.asked(context);
      timing.mark("sent");
      void ask(
        context,
        (event) => {
          if (asking.current !== control) return;
          if (event.type === "timing") return timing.note({ server: event });
          if (event.type !== "status" && event.type !== "heard") timing.mark("agent");
          switch (event.type) {
            case "status":
              update((x) => ({ ...x, tone: "busy", status: event.text }));
              break;
            case "heard":
              walker.hearing(event.text);
              timing.mark("heard");
              timing.note({ line: event.text, ear: event.ear });
              update((x) => ({ ...x, heard: event.text }));
              break;
            case "show":
              update((x) => ({ ...x, tone: "showing", walk: event.beats }));
              walker.start(event.beats, pageNow.current);
              watch(event.id);
              break;
            case "act":
              act(event.id, event.acts);
              break;
            case "annotate": {
              const was =
                event.revises === true
                  ? waiting(queueNow.current)
                      .filter((a) => a.target === event.target)
                      .at(-1)
                  : undefined;
              if (was !== undefined) {
                setState((s) => ({
                  ...s,
                  queue: {
                    ...s.queue,
                    annotations: s.queue.annotations.map((a) =>
                      a.id === was.id ? { ...a, text: event.text } : a,
                    ),
                  },
                }));
                update((x) => ({ ...x, annotation: was.id }));
                break;
              }
              const id = note(event.target, event.text);
              update((x) => ({ ...x, annotation: id }));
              break;
            }
            case "done":
              done?.(event.text);
              walker.unhold();
              update((x) => ({
                ...x,
                tone: "done",
                status: event.text === "" ? "Done" : event.text,
              }));
              break;
            case "failed":
              walker.unhold();
              update((x) => ({ ...x, tone: "failed", status: event.why }));
              break;
          }
        },
        control.signal,
        guide.voice ? guide.speaker : undefined,
      ).then((answered) => {
        if (answered || control.signal.aborted) return;
        const id = note(target, text);
        walker.start([heard(target, state.delay)], page);
        update((x) => ({ ...x, tone: "done", status: "In the queue", annotation: id }));
      });
    }
  };

  const talk = usePointAndTalk({
    onStart: () => {
      moment.current = momentNow();
      walker.attend();
    },
    onWords: (spoken, text, pointed, drawn, at) => askAgent(spoken, text, pointed, drawn, at),
    fast: fastEars,
  });

  /** He says why the answer was wrong; the dev server keeps it for a new eval case. */
  function sendWrong(reason: string) {
    setExchange((x) => (x === undefined ? x : { ...x, wrong: "saving" }));
    void timing
      .reportWrong(reason)
      .then((ok) =>
        setExchange((x) => (x === undefined ? x : { ...x, wrong: ok ? "saved" : "failed" })),
      );
  }
  const askWrong = (open: boolean) =>
    setExchange((x) => (x === undefined ? x : { ...x, wrong: open ? "asking" : undefined }));
  const answered_ =
    exchange !== undefined && (exchange.tone === "done" || exchange.tone === "failed");

  /** What the panel's line says about the exchange: his words, and the agent's answer. */
  const line = (() => {
    if (talk.phase === "listening")
      return { said: talk.words, tone: "listening", status: "Listening" } as const;
    if (talk.phase === "thinking")
      return { said: undefined, tone: "busy", status: "Hearing you" } as const;
    if (exchange === undefined) return undefined;
    const annotation = exchange.annotation;
    const answered = annotation !== undefined && answerOf(q, annotation) !== undefined;
    const due =
      annotation === undefined ? undefined : q.annotations.find((a) => a.id === annotation);
    const left =
      due === undefined || answered
        ? undefined
        : Math.max(0, Math.ceil((due.at + state.delay * 1000 - clock) / 1000));
    return {
      said: exchange.said === "" ? undefined : exchange.said,
      heard: exchange.heard,
      wrong: answered_
        ? {
            state: exchange.wrong ?? ("idle" as const),
            onOpen: () => askWrong(true),
            onSend: sendWrong,
            onClose: () => askWrong(false),
          }
        : undefined,
      tone: exchange.tone,
      // While it shows him, the line says what the cursor says.
      status: exchange.tone === "showing" ? (walk.note?.words ?? "Showing you") : exchange.status,
      beat: exchange.tone === "showing" ? { at: walk.beat, of: walk.beats } : undefined,
      change:
        annotation === undefined
          ? undefined
          : answered
            ? "Its answer is in the queue"
            : `Back in ${String(left ?? 0)} s`,
      onAgain:
        exchange.walk === undefined || exchange.tone === "busy" || walker.active()
          ? undefined
          : () => exchange.walk !== undefined && walker.start(exchange.walk, page),
    } as const;
  })();

  const open = (target: string) => {
    const now = momentNow();
    walker.pause();
    setComposer({ target, text: "", moment: now });
  };
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
        moment: composer.moment,
      }),
    }));
    setComposer(undefined);
  };
  /** Keep a variant, or send an answer: only a click or Enter does it. */
  const choose = (value: string) => {
    if (here !== undefined) {
      remember();
      setState((s) => ({ ...s, queue: pick(s.queue, here.id, value) }));
    }
    setPeek(undefined);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (
        composer !== undefined ||
        talk.phase === "typing" ||
        typing ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      const values = here?.variants ?? here?.options ?? [];
      const n = Number(e.key);
      if (e.key === "ArrowRight" || e.key === "j") move(next);
      else if (e.key === "ArrowLeft" || e.key === "k") move(back);
      else if (e.key === " ") toggleWalk();
      else if (n >= 1 && n <= values.length) setPeek(values[n - 1]);
      else if (e.key === "Enter" && peek !== undefined) choose(peek);
      else if (e.key === "Escape" && walk.phase !== "idle" && walk.phase !== "done") walker.stop();
      else if (e.key === "Escape" && peek !== undefined) setPeek(undefined);
      else if (e.key === "Escape" && tree) setTree(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const changed = new Set(
    q.annotations
      .filter((a) => answerOf(q, a.id) !== undefined)
      .map((a) => targetOf(a.target))
      .filter((t) => !(before && here?.kind === "answer" && t === targetOf(here.target))),
  );

  return (
    <>
      <Controls
        state={state}
        setState={setState}
        guide={guide}
        setGuide={setGuide}
        reset={() => {
          setState(fresh(state.delay));
          walker.stop();
          asking.current?.abort();
          setExchange(undefined);
          forget();
        }}
      />
      <main
        // The page narrows by the panel's width, so the panel covers nothing.
        style={{ marginRight: PANEL }}
        className="min-h-screen bg-[#fbfbfc] px-8 py-20 text-[#16161a]"
      >
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          <AppNav path={page} onGo={go} />
          <AppPage
            path={page}
            onGo={go}
            changed={changed}
            status={
              [
                here?.id === "r-status" ? (peek ?? guidePeek?.variant) : undefined,
                q.picks["r-status"],
              ].find((v) => v !== undefined && designOf("r-status", v) === undefined) ?? "Dot"
            }
            statusText={here?.id === "r-status" ? (shown ?? guidePeek?.state) : undefined}
          />
          <Designs shown={designs} />
        </div>
      </main>
      <Pins queue={q} page={page} onShow={(id) => move((s) => show(s, id))} />
      <Guide walker={walker} reduced={guide.reduced} />
      <TalkView talk={talk} reduced={guide.reduced} />
      <Panel
        docked
        preview={(r, v, state) => {
          const html = r.designs?.[v];
          return html === undefined ? (
            <Board remark={r.id} value={v} state={state} />
          ) : (
            <DesignPreview html={html} state={state ?? r.states?.[0] ?? ""} />
          );
        }}
        peek={peek ?? (here?.kind === "choice" ? guidePeek?.variant : undefined)}
        state={shown ?? guidePeek?.state}
        onState={setShown}
        onPeek={setPeek}
        walk={here?.walk === undefined ? undefined : walk.phase}
        beat={{ at: walk.beat, of: walk.beats }}
        before={before}
        onBefore={setBefore}
        onWalk={toggleWalk}
        voice={guide.voice}
        onVoice={() => setGuide((g) => ({ ...g, voice: !g.voice }))}
        queue={q}
        eta={eta}
        composer={composer}
        toast={toast}
        leftOpen={leftOpen}
        onSettleOpen={settleOpen}
        exchange={line}
        ship={ship}
        onNext={() => move(next)}
        onBack={() => move(back)}
        onShow={(id) => move((s) => show(s, id))}
        tree={tree}
        onTree={setTree}
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
  guide,
  setGuide,
  reset,
}: {
  readonly state: State;
  readonly setState: (to: (s: State) => State) => void;
  readonly guide: GuideSettings;
  readonly setGuide: (guide: GuideSettings) => void;
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
      <span className="flex items-center gap-1">
        Cursor
        <GuideToggle label="Walks" on={guide.on} onChange={(on) => setGuide({ ...guide, on })} />
        <GuideToggle
          label="Voice"
          on={guide.voice}
          onChange={(voice) => setGuide({ ...guide, voice })}
        />
        {guide.voice &&
          VOICES.map((v) => (
            <GuideToggle
              key={v.id}
              label={v.name}
              on={guide.speaker === v.id}
              onChange={() => setGuide({ ...guide, speaker: v.id })}
            />
          ))}
        <GuideToggle
          label="Less motion"
          on={guide.reduced}
          onChange={(reduced) => setGuide({ ...guide, reduced })}
        />
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

/** The number of the remark that shows, on a tab beside its element, and a mark at each
 * other open remark on the page and at each annotation with the agent. The agent's cursor
 * draws on the element itself. */
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
  const drawn = mine.flatMap((a) => a.drawn?.map((d) => d.path) ?? []);
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
      {/* What he drew stays on the page while the agent works on it. */}
      <Strokes paths={drawn} faint />
      {frame !== undefined && here !== undefined && (
        <span
          className={cx(
            "absolute grid h-5 min-w-5 -translate-y-1/2 animate-dt-arrive place-items-center rounded-[6px] px-1 text-[10px] font-semibold text-white tabular-nums shadow-dt-float transition-[left,top] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]",
            answer ? "bg-dt-good" : "bg-dt-accent",
          )}
          style={{ left: frame.right + 16, top: frame.top + 2 }}
        >
          {answer ? <CornerDownRight className="size-3" aria-hidden /> : numberOf(here)}
        </span>
      )}
      {others.map((r) => {
        const rect = box(r.target);
        if (rect === undefined) return null;
        const at = slot(r.target);
        return (
          <button
            key={r.id}
            type="button"
            aria-label={`Remark ${String(numberOf(r))}: ${r.title}`}
            title={r.title}
            onClick={() => onShow(r.id)}
            className="pointer-events-auto absolute grid h-5 min-w-5 -translate-y-1/2 animate-dt-fade place-items-center rounded-[6px] bg-dt-panel px-1 text-[10px] font-semibold text-dt-muted tabular-nums shadow-dt-float transition-[scale,color] hover:scale-110 hover:text-dt-text"
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
