import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../../ui/cx";
import { selectorOf, TARGETS } from "./script";
import type { Drawn, Pointed } from "../../queue/queue";
import { hear, type Word } from "./voice";

/*
 * Point and talk, as Clicky's push-to-talk: hold ⌥⌘, point at an element and say what should
 * change; let go, and the words become an annotation on the element pointed at. The press
 * stops the agent's walk and its voice at once. The microphone is on only while the keys are
 * held, and it needs a secure page (https).
 *
 * He may point at more than one element while he speaks: "this one should look like that
 * one". Each word has its time in the audio, so each goes with the element under the mouse
 * when he said it, and the agent knows which "this" is which. He may also draw while he holds
 * the keys, as in Clicky: a press and a drag circles or underlines, and the stroke snaps to
 * the element it surrounds. The strokes go with the words.
 */

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type Talk =
  | { readonly phase: "idle" }
  /** The keys are held: the element under the mouse, and how loud he speaks, 0 to 1. */
  | {
      readonly phase: "listening";
      readonly target: string | undefined;
      readonly box: Box | undefined;
      /** The elements he pointed at before, while he spoke. */
      readonly before: readonly Box[];
      /** What he drew, as SVG paths in page coordinates. */
      readonly strokes: readonly string[];
      readonly level: number;
      readonly at: { readonly x: number; readonly y: number };
    }
  /** The keys are let go: the words become text. */
  | {
      readonly phase: "writing";
      readonly target: string | undefined;
      readonly box: Box | undefined;
      readonly strokes: readonly string[];
      readonly at: { readonly x: number; readonly y: number };
    }
  /** It could not listen or hear, and says why for a moment. */
  | {
      readonly phase: "failed";
      readonly why: string;
      readonly at: { readonly x: number; readonly y: number };
    };

/** A hold shorter than this is a slip, not words. */
const SHORTEST = 300;

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

type Point = { readonly x: number; readonly y: number };

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

export function usePointAndTalk({
  onStart,
  onWords,
}: {
  /** The keys are pressed: the walk and its voice stop. */
  readonly onStart: () => void;
  /** What he said, which is empty when he only drew; the element he said the most words on,
   * or pointed at last; each element he pointed at, with its words; and what he drew. */
  readonly onWords: (
    target: string | undefined,
    text: string,
    pointed: readonly Pointed[],
    drawn: readonly Drawn[],
  ) => void;
}): Talk {
  const [talk, setTalk] = useState<Talk>(IDLE);
  const calls = useRef({ onStart, onWords });
  calls.current = { onStart, onWords };

  useEffect(() => {
    let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    let held = false;
    let since = 0;
    let target: string | undefined;
    let box: Box | undefined;
    let level = 0;
    let frame = 0;
    let end: (() => void) | undefined;
    let failing = 0;
    let trail: { target: string | undefined; at: number }[] = [];
    let heardFrom = 0;
    let strokes: { points: Point[]; target: string | undefined }[] = [];
    let pen: Point[] | undefined;
    const paths = () => [...strokes.map((s) => pathOf(s.points)), ...(pen ? [pathOf(pen)] : [])];
    const point = () => {
      if (trail.at(-1)?.target === target) return;
      trail.push({ target, at: heardFrom === 0 ? 0 : Date.now() - heardFrom });
    };
    const before = () =>
      [...new Set(trail.map((t) => t.target))].flatMap((t) => {
        if (t === undefined || t === target) return [];
        const r = document.querySelector(t)?.getBoundingClientRect();
        return r === undefined
          ? []
          : [{ left: r.left, top: r.top, width: r.width, height: r.height }];
      });

    const fail = (why: string) => {
      setTalk({ phase: "failed", why, at: mouse });
      window.clearTimeout(failing);
      failing = window.setTimeout(() => setTalk(IDLE), 2400);
    };
    const show = () => {
      if (held)
        setTalk({
          phase: "listening",
          target,
          box,
          before: before(),
          strokes: paths(),
          level,
          at: mouse,
        });
    };

    const start = async () => {
      held = true;
      since = Date.now();
      trail = [];
      heardFrom = 0;
      strokes = [];
      pen = undefined;
      ({ target, box } = pointed(mouse.x, mouse.y));
      point();
      calls.current.onStart();
      show();
      if (navigator.mediaDevices === undefined) {
        held = false;
        return fail("The microphone needs https");
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        const drawn = strokes.map((s) => ({ path: pathOf(s.points), target: s.target }));
        if (Date.now() - since < SHORTEST && drawn.length === 0) return setTalk(IDLE);
        setTalk({ phase: "writing", target, box, strokes: paths(), at: mouse });
        void hear(new Blob(chunks, { type: recorder.mimeType })).then((heard) => {
          setTalk(IDLE);
          // A drawing with no words opens the composer to write in.
          if (heard === undefined && drawn.length > 0) {
            const last = drawn.at(-1)?.target;
            return calls.current.onWords(last ?? target, "", [], drawn);
          }
          if (heard === undefined) return fail("I heard nothing");
          const pointed = pointedWhile(heard.words, trail);
          const most = [...pointed].sort(
            (a, b) => b.words.split(" ").length - a.words.split(" ").length,
          )[0];
          calls.current.onWords(most?.target ?? target, heard.text, pointed, drawn);
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
      if (pen !== undefined) {
        const last = pen.at(-1);
        const here = { x: e.clientX + scrollX, y: e.clientY + scrollY };
        if (last === undefined || Math.hypot(here.x - last.x, here.y - last.y) > 2) pen.push(here);
      } else {
        ({ target, box } = pointed(mouse.x, mouse.y));
        point();
      }
      show();
    };
    // While the keys are held, a press draws, and the page gets no press or click.
    const onPress = (e: PointerEvent) => {
      if (!held) return;
      e.preventDefault();
      e.stopPropagation();
      pen = [{ x: e.clientX + scrollX, y: e.clientY + scrollY }];
    };
    const onLift = (e: PointerEvent) => {
      if (pen === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      const points = pen;
      pen = undefined;
      if (points.length > 2) {
        ({ target, box } = snap(points));
        strokes.push({ points, target });
        point();
      }
      show();
    };
    const onClick = (e: MouseEvent) => {
      if (!held) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("pointerup", onLift, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("pointerup", onLift, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("blur", stop);
      window.clearTimeout(failing);
      stop();
    };
  }, []);

  return talk;
}

const name = (target: string | undefined) =>
  target === undefined
    ? "the page"
    : (TARGETS[/data-q="([^"]+)"/.exec(target)?.[1] ?? ""] ?? "the element");

/**
 * What point and talk shows: the light on the element pointed at, in the reviewer's own colour
 * as his annotations have, and a chip by the mouse with the element's name and how loud he
 * speaks. While the words become text, the chip breathes.
 */
export function TalkView({ talk, reduced }: { readonly talk: Talk; readonly reduced: boolean }) {
  if (talk.phase === "idle") return null;
  const box = talk.phase === "failed" ? undefined : talk.box;
  return (
    <div className="blueline pointer-events-none fixed inset-0 z-[2147483004]">
      {talk.phase !== "failed" && <Strokes paths={talk.strokes} />}
      {/* What he pointed at before, while he spoke, stays lit, fainter. */}
      {talk.phase === "listening" &&
        talk.before.map((b) => (
          <span
            key={`${String(b.left)}-${String(b.top)}`}
            className="absolute rounded-dt-mark ring-2 ring-dt-warn/40"
            style={{ left: b.left - 4, top: b.top - 4, width: b.width + 8, height: b.height + 8 }}
          />
        ))}
      {box !== undefined && (
        <span
          className={cx(
            "absolute rounded-dt-mark ring-2 ring-dt-warn",
            !reduced && "transition-[left,top,width,height] duration-150 ease-out",
          )}
          style={{
            left: box.left - 4,
            top: box.top - 4,
            width: box.width + 8,
            height: box.height + 8,
          }}
        />
      )}
      <span
        role="status"
        className={cx(
          "absolute flex h-7 items-center gap-2 rounded-full bg-dt-panel pr-3 pl-2 text-[12px] font-medium whitespace-nowrap text-dt-text shadow-dt-float",
          !reduced && "animate-dt-fade",
          talk.phase === "writing" && !reduced && "animate-pulse",
        )}
        style={{ left: talk.at.x + 16, top: talk.at.y + 14 }}
      >
        {talk.phase === "failed" ? (
          <>
            <Mic className="size-3.5 text-dt-faint" aria-hidden />
            <span className="text-dt-muted">{talk.why}</span>
          </>
        ) : (
          <>
            <Level level={talk.phase === "listening" ? talk.level : 0.15} />
            <span>{name(talk.target)}</span>
          </>
        )}
      </span>
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
            className={cx("stroke-dt-warn", faint && "opacity-45")}
            strokeWidth={faint ? 2 : 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}

/** How loud he speaks: five bars that rise with his voice, highest in the middle. */
function Level({ level }: { readonly level: number }) {
  return (
    <span className="flex h-3.5 items-center gap-[2px]" aria-hidden>
      {[0.55, 0.8, 1, 0.8, 0.55].map((weight, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-dt-warn"
          style={{ height: `${String(Math.max(18, Math.min(100, level * weight * 160)))}%` }}
        />
      ))}
    </span>
  );
}
