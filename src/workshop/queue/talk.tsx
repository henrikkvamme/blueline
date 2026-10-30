import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../../ui/cx";
import { selectorOf } from "./script";
import type { Drawn, Pointed } from "../../queue/queue";
import { hear, type Word } from "./voice";

/*
 * Point and talk, as Clicky's push-to-talk: hold ⌥⌘, point and say what should change. The
 * press stops the agent's walk and its voice at once. While the keys are held the cursor
 * leaves ink, which fades behind it; a loop that closes stays, and snaps to the element it
 * surrounds. The agent's waveform by the cursor shows that it listens, and its spinner that it
 * thinks, in the agent's colour: it stands where its cursor would. Let
 * go, and the words go to the agent as an annotation, with no box to write in: the agent
 * answers on the page. The microphone is on only while the keys are held, and it needs a
 * secure page (https).
 *
 * He may point at more than one element while he speaks: "this one should look like that
 * one". Each word has its time in the audio, so each goes with the element under the mouse
 * when he said it, and the agent knows which "this" is which.
 */

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

type Point = { readonly x: number; readonly y: number };

/** A piece of the ink behind the cursor, and how much of it is left, 0 to 1. */
export interface Ink {
  readonly d: string;
  readonly left: number;
}

export type Talk =
  | { readonly phase: "idle" }
  /** The keys are held: the ink behind the cursor, the loops that stay, and how loud he
   * speaks, 0 to 1. */
  | {
      readonly phase: "listening";
      readonly ink: readonly Ink[];
      readonly strokes: readonly string[];
      readonly level: number;
      readonly at: Point;
    }
  /** The keys are let go: the words become text. */
  | { readonly phase: "thinking"; readonly strokes: readonly string[]; readonly at: Point }
  /** It could not listen or hear, and says why for a moment. */
  | { readonly phase: "failed"; readonly why: string; readonly at: Point };

/** A hold shorter than this is a slip, not words. */
const SHORTEST = 300;

/** How long the ink stays behind the cursor, in ms. */
const INK = 900;

/** A loop closes when the cursor comes this near to where it was, after this much ink. */
const LOOP = { near: 36, length: 140 } as const;

const IDLE: Talk = { phase: "idle" };

/** Where the mouse was while he spoke: each element, from when, in ms of the audio. */
type Trail = readonly { readonly target: string | undefined; readonly at: number }[];

/**
 * His words, each with the element under the mouse when he said it, as runs of words on one
 * element. Words said off any element go with the element before them, or else the next.
 */
export function pointedWhile(words: readonly Word[], trail: Trail): readonly Pointed[] {
  const on = (seconds: number) =>
    trail.filter((t) => t.at <= seconds * 1000).at(-1)?.target ?? trail[0]?.target;
  const runs: { target: string | undefined; words: string[] }[] = [];
  for (const word of words) {
    const target = on((word.start + word.end) / 2) ?? runs.at(-1)?.target;
    const last = runs.at(-1);
    if (last !== undefined && (last.target === target || target === undefined))
      last.words.push(word.text);
    else if (last !== undefined && last.target === undefined) {
      last.target = target;
      last.words.push(word.text);
    } else runs.push({ target, words: [word.text] });
  }
  return runs.flatMap((r) =>
    r.target === undefined ? [] : [{ target: r.target, words: r.words.join(" ") }],
  );
}

/** A stroke as an SVG path, in page coordinates. */
const pathOf = (points: readonly Point[]) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(0)} ${p.y.toFixed(0)}`).join(" ");

/**
 * The element a stroke is about: the one whose box matches the stroke's box best, so a loop
 * round the status takes the status and not the card it sits in. A stroke that matches none
 * well, such as a short line, takes the element just above its middle, as an underline does.
 */
function snap(points: readonly Point[]) {
  const xs = points.map((p) => p.x - scrollX);
  const ys = points.map((p) => p.y - scrollY);
  const box = {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
  const area = (w: number, h: number) => Math.max(0, w) * Math.max(0, h);
  const own = area(box.right - box.left, box.bottom - box.top);
  let best: { target: string; box: Box; score: number } | undefined;
  for (const el of document.querySelectorAll("[data-q]")) {
    const r = el.getBoundingClientRect();
    const overlap = area(
      Math.min(r.right, box.right) - Math.max(r.left, box.left),
      Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top),
    );
    const score = overlap / (own + r.width * r.height - overlap);
    if (score > (best?.score ?? 0.15))
      best = {
        target: selectorOf(el.getAttribute("data-q") ?? ""),
        box: { left: r.left, top: r.top, width: r.width, height: r.height },
        score,
      };
  }
  if (best !== undefined) return { target: best.target, box: best.box };
  return pointed((box.left + box.right) / 2, box.top - 8);
}

/** The element of the app under a point: its target, and where it is. */
function pointed(x: number, y: number) {
  const el = document.elementFromPoint(x, y)?.closest("[data-q]");
  if (el === null || el === undefined) return { target: undefined, box: undefined };
  const r = el.getBoundingClientRect();
  return {
    target: selectorOf(el.getAttribute("data-q") ?? ""),
    box: { left: r.left, top: r.top, width: r.width, height: r.height },
  };
}

/** The built-in microphone, by its name in the browser. */
const BUILT_IN = /macbook.*microphone|built-in microphone/i;

/** The device ID of the microphone in use, kept for the next press. */
let chosen: string | undefined;

/**
 * The microphone to record from: the Mac's own when it has one. A Bluetooth headset's
 * microphone, such as AirPods', switches the headset to its call profile, which makes his
 * voice and the agent's sound poor. The browser names devices only after the first
 * permission, so the first press may ask the default microphone first, then switch.
 */
async function microphone(): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  const open = (id: string) => media.getUserMedia({ audio: { deviceId: { exact: id } } });
  const builtIn = async () =>
    (await media.enumerateDevices()).find((d) => d.kind === "audioinput" && BUILT_IN.test(d.label))
      ?.deviceId;
  if (chosen !== undefined)
    try {
      return await open(chosen);
    } catch {
      chosen = undefined;
    }
  const known = await builtIn();
  if (known !== undefined && known !== "") {
    chosen = known;
    return open(known);
  }
  const first = await media.getUserMedia({ audio: true });
  const named = await builtIn();
  if (
    named === undefined ||
    named === "" ||
    first.getAudioTracks()[0]?.getSettings().deviceId === named
  )
    return first;
  for (const track of first.getTracks()) track.stop();
  chosen = named;
  return open(named);
}

/** The loop that the ink closes, if it closes: the cursor came back near where it was, after
 * enough ink to go round something. */
function closed<T extends Point>(points: readonly T[]): readonly T[] | undefined {
  const end = points.at(-1);
  if (end === undefined) return undefined;
  let length = 0;
  for (let i = points.length - 1; i > 0; i--) {
    const [a, b] = [points[i], points[i - 1]];
    if (a === undefined || b === undefined) return undefined;
    length += Math.hypot(a.x - b.x, a.y - b.y);
    if (length >= LOOP.length && Math.hypot(b.x - end.x, b.y - end.y) <= LOOP.near)
      return points.slice(i - 1);
  }
  return undefined;
}

export function usePointAndTalk({
  onStart,
  onWords,
}: {
  /** The keys are pressed: the walk and its voice stop. */
  readonly onStart: () => void;
  /** What he said; the element he said the most words on, else the last he circled or
   * pointed at; each element he pointed at, with its words; and the loops he drew. */
  readonly onWords: (
    target: string | undefined,
    text: string,
    pointed: readonly Pointed[],
    drawn: readonly Drawn[],
    at: Point,
  ) => void;
}): Talk {
  const [talk, setTalk] = useState<Talk>(IDLE);
  const calls = useRef({ onStart, onWords });
  calls.current = { onStart, onWords };

  useEffect(() => {
    let mouse: Point = { x: innerWidth / 2, y: innerHeight / 2 };
    let held = false;
    let since = 0;
    let target: string | undefined;
    let level = 0;
    let frame = 0;
    let end: (() => void) | undefined;
    let failing = 0;
    let trail: { target: string | undefined; at: number }[] = [];
    let heardFrom = 0;
    // The ink, in the viewport, with when each point came; the loops, in the page.
    let ink: { x: number; y: number; t: number }[] = [];
    let loops: { points: Point[]; target: string | undefined }[] = [];

    const point = () => {
      if (trail.at(-1)?.target === target) return;
      trail.push({ target, at: heardFrom === 0 ? 0 : Date.now() - heardFrom });
    };
    const strokes = () => loops.map((l) => pathOf(l.points));
    const pieces = (): Ink[] => {
      const now = Date.now();
      ink = ink.filter((p) => now - p.t < INK);
      return ink.slice(1).flatMap((p, i) => {
        const q = ink[i];
        if (q === undefined) return [];
        return [{ d: `M ${q.x} ${q.y} L ${p.x} ${p.y}`, left: 1 - (now - p.t) / INK }];
      });
    };
    const fail = (why: string) => {
      setTalk({ phase: "failed", why, at: mouse });
      window.clearTimeout(failing);
      failing = window.setTimeout(() => setTalk(IDLE), 2400);
    };
    const show = () => {
      if (held)
        setTalk({ phase: "listening", ink: pieces(), strokes: strokes(), level, at: mouse });
    };

    const start = async () => {
      held = true;
      since = Date.now();
      trail = [];
      heardFrom = 0;
      ink = [{ ...mouse, t: Date.now() }];
      loops = [];
      ({ target } = pointed(mouse.x, mouse.y));
      point();
      calls.current.onStart();
      show();
      if (navigator.mediaDevices === undefined) {
        held = false;
        return fail("The microphone needs https");
      }
      let stream: MediaStream;
      try {
        stream = await microphone();
      } catch {
        held = false;
        return fail("No microphone");
      }
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const listen = () => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
        // Speech sits near 0.02 to 0.2; the meter eases toward it.
        level = level * 0.6 + Math.min(1, rms * 6) * 0.4;
        show();
        frame = requestAnimationFrame(listen);
      };
      const release = () => {
        cancelAnimationFrame(frame);
        for (const track of stream.getTracks()) track.stop();
        void audio.close();
      };
      recorder.onstop = () => {
        release();
        const drawn = loops.map((l) => ({ path: pathOf(l.points), target: l.target }));
        if (Date.now() - since < SHORTEST) return setTalk(IDLE);
        setTalk({ phase: "thinking", strokes: strokes(), at: mouse });
        void hear(new Blob(chunks, { type: recorder.mimeType })).then((heard) => {
          if (heard === undefined) return fail("I heard nothing");
          setTalk(IDLE);
          const pointed = pointedWhile(heard.words, trail);
          const most = [...pointed].sort(
            (a, b) => b.words.split(" ").length - a.words.split(" ").length,
          )[0];
          // What he circled wins: it is what he meant. Else what he spoke most about.
          calls.current.onWords(
            drawn.at(-1)?.target ?? most?.target ?? target,
            heard.text,
            pointed,
            drawn,
            mouse,
          );
        });
      };
      end = () => recorder.stop();
      // He let go before the microphone was ready.
      if (!held) return end();
      recorder.start();
      heardFrom = Date.now();
      listen();
    };

    const stop = () => {
      if (!held) return;
      held = false;
      if (end === undefined) return setTalk(IDLE);
      end();
      end = undefined;
    };

    const onDown = (e: KeyboardEvent) => {
      const chord = e.altKey && e.metaKey && (e.key === "Alt" || e.key === "Meta");
      if (chord && !held && !e.repeat) {
        e.preventDefault();
        void start();
      } else if (held && e.key !== "Alt" && e.key !== "Meta") stop();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.key === "Meta") stop();
    };
    const onMove = (e: PointerEvent) => {
      mouse = { x: e.clientX, y: e.clientY };
      if (!held) return;
      const last = ink.at(-1);
      if (last === undefined || Math.hypot(mouse.x - last.x, mouse.y - last.y) > 3)
        ink.push({ ...mouse, t: Date.now() });
      const loop = closed(ink);
      if (loop !== undefined) {
        const points = loop.map((p) => ({ x: p.x + scrollX, y: p.y + scrollY }));
        ({ target } = snap(points));
        loops.push({ points, target });
        ink = [{ ...mouse, t: Date.now() }];
        // The words said while he drew the loop are about what it circles, not about what
        // the mouse crossed on the way round.
        const from = Math.max(0, (loop[0]?.t ?? Date.now()) - heardFrom);
        trail = trail.filter((t) => t.at < from);
        trail.push({ target, at: heardFrom === 0 ? 0 : from });
      } else if (loops.length === 0) {
        // A loop holds until he lets go, as Clicky's snap does; before one, he points.
        ({ target } = pointed(mouse.x, mouse.y));
        point();
      }
      show();
    };
    // While the keys are held, the page gets no press and no click.
    const swallow = (e: Event) => {
      if (!held) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", swallow, true);
    window.addEventListener("click", swallow, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", swallow, true);
      window.removeEventListener("click", swallow, true);
      window.removeEventListener("blur", stop);
      window.clearTimeout(failing);
      stop();
    };
  }, []);

  return talk;
}

/**
 * What point and talk shows, in the reviewer's own colour as his annotations have: the ink
 * behind the cursor, the loops that stay, and by the cursor a waveform while it listens, a
 * spinner while it thinks, or why it failed.
 */
export function TalkView({ talk, reduced }: { readonly talk: Talk; readonly reduced: boolean }) {
  if (talk.phase === "idle") return null;
  const by = { left: talk.at.x + 14, top: talk.at.y + 12 };
  return (
    <div className="blueline pointer-events-none fixed inset-0 z-[2147483004]">
      {talk.phase !== "failed" && <Strokes paths={talk.strokes} />}
      {talk.phase === "listening" && talk.ink.length > 0 && (
        <svg aria-hidden className="absolute inset-0 size-full overflow-visible">
          {talk.ink.map((piece, i) => (
            <path
              key={i}
              d={piece.d}
              className="stroke-dt-accent"
              strokeWidth={1 + piece.left * 2.5}
              strokeLinecap="round"
              opacity={piece.left}
            />
          ))}
        </svg>
      )}
      {talk.phase === "listening" && (
        <span className="absolute" style={by} role="status" aria-label="Listening">
          <Level level={talk.level} />
        </span>
      )}
      {talk.phase === "thinking" && (
        <span
          className={cx(
            "absolute size-3.5 rounded-full border-2 border-dt-accent border-t-transparent drop-shadow-[0_0_5px_rgb(74_108_247/0.7)]",
            !reduced && "animate-spin",
          )}
          style={by}
          role="status"
          aria-label="Thinking"
        />
      )}
      {talk.phase === "failed" && (
        <span
          role="status"
          className="absolute flex h-7 animate-dt-fade items-center gap-1.5 rounded-full bg-dt-panel pr-3 pl-2 text-[12px] whitespace-nowrap text-dt-muted shadow-dt-float"
          style={by}
        >
          <Mic className="size-3.5 text-dt-faint" aria-hidden />
          {talk.why}
        </span>
      )}
    </div>
  );
}

/** What he drew, in his own colour, on the page: the paths are in page coordinates, so the
 * strokes stay on their elements as the page scrolls. Fainter once sent, while the agent
 * works on them. */
export function Strokes({
  paths,
  faint = false,
}: {
  readonly paths: readonly string[];
  readonly faint?: boolean;
}) {
  if (paths.length === 0) return null;
  return (
    <svg aria-hidden className="pointer-events-none fixed inset-0 size-full overflow-visible">
      <g transform={`translate(${String(-scrollX)} ${String(-scrollY)})`}>
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            className={cx("stroke-dt-accent", faint && "opacity-45")}
            strokeWidth={faint ? 2 : 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}

/** How loud he speaks, as Clicky's waveform by the cursor: five bars that rise with his
 * voice, highest in the middle, with a glow. A slow wave keeps them alive while he is quiet,
 * so it is clear that it listens. */
function Level({ level }: { readonly level: number }) {
  const now = Date.now() / 1000;
  const loud = Math.pow(Math.min(Math.max(level - 0.01, 0) * 2.85, 1), 0.76);
  return (
    <span
      className="flex h-5 items-center gap-[2.5px] drop-shadow-[0_0_6px_rgb(74_108_247/0.9)]"
      aria-hidden
    >
      {[0.45, 0.75, 1, 0.75, 0.45].map((weight, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-dt-accent"
          style={{
            height: 4 + loud * 16 * weight + ((Math.sin(now * 3.6 + i * 0.6) + 1) / 2) * 2.5,
          }}
        />
      ))}
    </span>
  );
}
