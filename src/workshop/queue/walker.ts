import type { Beat } from "../../queue/queue";
import { MotionPlayer } from "../../vendor/cua-cursor-motion.js";
import { fetchLine, hush, say } from "./voice";

/*
 * The agent's cursor as a controller: it walks a remark's beats, and the reviewer always wins.
 *
 * - It yields on request, as Clicky does. Escape pauses it and stops its voice at once; a
 *   second Escape dismisses it; g pauses and goes on. Nothing else pauses it: he moves,
 *   clicks, scrolls and types while it speaks, and it never fights him for the page.
 * - It never trusts old coordinates. While a beat shows, it watches its element through
 *   scroll, resize, layout and DOM changes. A moved element takes the cursor with it; an
 *   element that is gone, or a page that changed, stops the walk with a reason.
 * - It shows and never does. A beat can preview a variant, which ends with the beat, and a
 *   beat that is the reviewer's turn waits for his own click. The cursor clicks nothing.
 *
 * It draws and notes rather than writes, as Clicky does. The voice says the whole line. On the
 * page, the cursor draws on the element (a loop, a line under it, or a frame for a turn), and
 * a note beside it holds a few words. With the voice off, the note holds the whole line too.
 *
 * The React layer draws its snapshot: the mark, the note, and the cursor's canvas, which the
 * cursor library paints.
 */

/** What a beat shows on the part while it shows: a variant, a state, or both. */
export interface Preview {
  readonly variant: string | undefined;
  readonly state: string | undefined;
}

export type Phase = "idle" | "moving" | "speaking" | "turn" | "paused" | "lost" | "done";

export interface Place {
  readonly left: number;
  readonly top?: number;
  readonly bottom?: number;
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** What the cursor draws on an element: a loop round it, a line under it, or the frame of
 * the reviewer's turn. */
export type Draw = "circle" | "underline" | "frame";

export interface Mark {
  readonly draw: Draw;
  readonly box: Box;
  /** A new key draws a new mark; the same key follows its element. */
  readonly key: string;
}

/** The agent's note beside the element, in the look of an annotation. */
export interface Note {
  readonly tone: "say" | "turn" | "paused" | "lost";
  /** The beat's number, from 1. */
  readonly step: number;
  /** A few words. */
  readonly words: string;
  /** The whole line, when no voice says it. */
  readonly line: string | undefined;
  readonly place: Place;
  /** A new key comes in as a new note. */
  readonly key: string;
}

export interface Snapshot {
  readonly phase: Phase;
  /** The beat that shows, and how many there are. */
  readonly beat: number;
  readonly beats: number;
  readonly note: Note | undefined;
  readonly mark: Mark | undefined;
  /** Whether the cursor is on the screen. */
  readonly shown: boolean;
}

export interface Settings {
  /** The ElevenLabs voice, or none for the words alone. */
  readonly voice: string | undefined;
  readonly reduced: boolean;
}

export const NOTE = { width: 232, gap: 10 } as const;

/** The cursor's size on the page, from its tip: its body goes right and down. */
const BODY = { right: 18, down: 26 };

/**
 * Where the cursor points at an element, and where its note stands: the tip touches the
 * element's edge from outside and the note sits by the cursor's body, as Clicky's does, so
 * neither covers the element. Right of it when the page has room, else under it, else over.
 */
export function aim(rect: Box, view: { readonly width: number; readonly height: number }) {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  if (right + BODY.right + NOTE.gap + NOTE.width + 12 <= view.width) {
    const tip = { x: right + 2, y: rect.top + Math.min(rect.height / 2, 18) };
    const place: Place = { left: tip.x + BODY.right + NOTE.gap, top: tip.y + 6 };
    return { tip, place };
  }
  const left = (x: number) => Math.max(12, Math.min(x, view.width - NOTE.width - 12));
  const x = rect.left + Math.min(rect.width * 0.3, 56);
  if (bottom + BODY.down + NOTE.gap + 48 <= view.height) {
    const tip = { x, y: bottom + 2 };
    const place: Place = { left: left(tip.x + 10), top: tip.y + BODY.down };
    return { tip, place };
  }
  const tip = { x, y: rect.top - 2 };
  const place: Place = { left: left(tip.x + 10), bottom: view.height - tip.y + NOTE.gap };
  return { tip, place };
}

const boxOf = (r: DOMRect): Box => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

const moved = (a: Box, b: Box) =>
  Math.abs(a.left - b.left) > 2 ||
  Math.abs(a.top - b.top) > 2 ||
  Math.abs(a.width - b.width) > 2 ||
  Math.abs(a.height - b.height) > 2;

const IDLE: Snapshot = {
  phase: "idle",
  beat: 0,
  beats: 0,
  note: undefined,
  mark: undefined,
  shown: false,
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export class Walker {
  private snap: Snapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private player: MotionPlayer | undefined;
  private walk: readonly Beat[] = [];
  private at = 0;
  /** Each start, pause and stop makes a new one, so an old loop ends at its next await. */
  private generation = 0;
  private settings: Settings = { voice: undefined, reduced: false };
  /** Where the reviewer's own mouse was last, for the cursor to come back to. */
  private mouse: { x: number; y: number } | undefined;
  private path = "";
  private previewing = false;
  private untrack: (() => void) | undefined;
  /** The element of the beat that shows, while it shows. */
  private element: Element | undefined;
  private unlisten: (() => void) | undefined;
  /** Resolves a turn: the reviewer clicked, or skipped it. */
  private turned: (() => void) | undefined;

  constructor(
    private readonly view: () => { readonly width: number; readonly height: number },
    private readonly onPreview: (preview: Preview | undefined) => void,
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.snap;

  /** The canvas that the cursor is drawn on; it comes in from the panel's edge. */
  attach(canvas: HTMLCanvasElement, fill: string) {
    const player = new MotionPlayer(canvas, { fill });
    player.place({ x: this.view().width - 40, y: this.view().height * 0.4 });
    this.player = player;
    return () => {
      player.destroy();
      this.player = undefined;
    };
  }

  configure(settings: Settings) {
    const was = this.settings;
    this.settings = settings;
    if (was.voice !== undefined && settings.voice === undefined) hush();
  }

  /** Walk a remark's beats from the first, on the page that shows. */
  start(walk: readonly Beat[], path: string) {
    this.halt();
    this.walk = walk;
    this.at = 0;
    this.path = path;
    if (walk.length === 0) return this.set(IDLE);
    this.set({ ...IDLE, beats: walk.length, shown: true });
    // Every line is asked for now, so each one plays without a wait.
    const voice = this.settings.voice;
    if (voice !== undefined) for (const beat of walk) void fetchLine(beat.say, voice);
    void this.play(this.generation);
  }

  /** The reviewer did something: the walk waits where it is, and its voice stops. What the
   * beat previews stays on the page, as he may speak about it. */
  pause() {
    if (!this.active()) return;
    this.halt(true);
    this.set({
      ...this.snap,
      phase: "paused",
      mark: undefined,
      note:
        this.snap.note === undefined
          ? undefined
          : { ...this.snap.note, tone: "paused", line: undefined, key: "paused" },
    });
    // The element may still change while the walk waits: the cursor and the note follow it,
    // so they never cover it.
    const beat = this.walk[this.at];
    if (beat !== undefined && this.element?.isConnected === true)
      this.track(beat, this.element, this.generation, (box) => {
        const note = this.snap.note;
        if (note !== undefined)
          this.set({ ...this.snap, note: { ...note, place: aim(box, this.view()).place } });
      });
  }

  /** Go on from the beat it stopped at, after a pause or a lost element. */
  resume() {
    if (this.snap.phase !== "paused" && this.snap.phase !== "lost") return;
    this.halt();
    this.set({ ...this.snap, phase: "moving", note: undefined, mark: undefined });
    void this.play(this.generation);
  }

  /** Escape: the walk ends, its voice stops, and the cursor goes. */
  stop() {
    this.halt();
    this.unlisten?.();
    this.unlisten = undefined;
    this.set({ ...IDLE, beats: this.walk.length });
  }

  /** The reviewer skips his turn. */
  skip() {
    this.turned?.();
  }

  /** The page that shows; a change while the walk runs stops it. */
  navigate(path: string) {
    if (path === this.path) return;
    this.path = path;
    if (this.active()) this.lose("The page changed, so I stopped here.");
  }

  /** Whether the walk runs: its cursor moves, speaks or waits for a turn. */
  active() {
    const { phase } = this.snap;
    return phase === "moving" || phase === "speaking" || phase === "turn";
  }

  destroy() {
    this.stop();
  }

  private set(snap: Snapshot) {
    this.snap = snap;
    for (const listener of this.listeners) listener();
  }

  /** Ends the running loop, its voice, its watchers, and its preview unless `keep`. Escape
   * still reaches the walker until it stops. */
  private halt(keep = false) {
    this.generation++;
    hush();
    this.turned = undefined;
    this.untrack?.();
    this.untrack = undefined;
    // A move in flight stops where the cursor is.
    if (this.player !== undefined) this.player.place(this.player.pos);
    if (this.previewing && !keep) {
      this.previewing = false;
      this.onPreview(undefined);
    }
  }

  private lose(why: string) {
    const tip = this.player?.pos ?? { x: 0, y: 0 };
    this.halt();
    this.set({
      ...this.snap,
      phase: "lost",
      mark: undefined,
      note: {
        tone: "lost",
        step: this.at + 1,
        words: "Lost it",
        line: why,
        key: `lost-${String(this.at)}`,
        place: aim({ left: tip.x - 2, top: tip.y - 2, width: 1, height: 1 }, this.view()).place,
      },
    });
  }

  private async play(generation: number) {
    const live = () => generation === this.generation;
    this.listen();
    while (this.at < this.walk.length) {
      const beat = this.walk[this.at];
      if (beat === undefined || !live()) return;
      if (beat.peek !== undefined || beat.state !== undefined) {
        this.previewing = true;
        this.onPreview({ variant: beat.peek, state: beat.state });
        // The page draws the preview before the cursor measures it.
        await sleep(60);
        if (!live()) return;
      }
      let element = this.find(beat);
      if (element === undefined) return this.lose(this.goneWords(beat));
      if (!this.inView(element)) {
        element.scrollIntoView({
          block: "center",
          behavior: this.settings.reduced ? "auto" : "smooth",
        });
        await sleep(this.settings.reduced ? 0 : 450);
        if (!live()) return;
        element = this.find(beat);
        if (element === undefined) return this.lose(this.goneWords(beat));
      }
      const rect = boxOf(element.getBoundingClientRect());
      this.set({ ...this.snap, phase: "moving", beat: this.at, mark: undefined, note: undefined });
      await this.player?.moveTo(aim(rect, this.view()).tip, {
        params: { style: "signature_arc", timing: "fitts" },
        target: [rect.left, rect.top, rect.width, rect.height],
        reducedMotion: this.settings.reduced,
      });
      if (!live()) return;
      const turn = beat.turn === true;
      const key = `${String(this.at)}-${String(generation)}`;
      const draw = turn ? "frame" : beat.draw;
      const voice = this.settings.voice;
      // With no voice, the note holds the whole line, so nothing that is said is lost.
      const words = beat.note ?? beat.say;
      const line = (heard: boolean) => (heard || words === beat.say ? undefined : beat.say);
      const show = (box: Box, heard: boolean) =>
        this.set({
          ...this.snap,
          phase: turn ? "turn" : "speaking",
          mark: draw === undefined ? undefined : { draw, box, key },
          note: {
            tone: turn ? "turn" : "say",
            step: this.at + 1,
            words,
            line: line(heard),
            place: aim(box, this.view()).place,
            key,
          },
        });
      let last = rect;
      let heard = voice !== undefined;
      show(rect, heard);
      this.element = element;
      this.track(beat, element, generation, (box) => {
        last = box;
        show(box, heard);
      });
      const read = () => sleep(900 + beat.say.split(/\s+/).length * 260);
      // A voice that plays sets the pace. With none, or one that fails, the note shows the
      // line and the time to read it does.
      const said =
        voice === undefined
          ? read()
          : say(beat.say, voice).then((spoke) => {
              if (spoke || !live()) return;
              heard = false;
              show(last, heard);
              return read();
            });
      if (turn) await Promise.all([this.turn(element), said]);
      else await said;
      await sleep(350);
      if (!live()) return;
      this.untrack?.();
      this.untrack = undefined;
      if (this.previewing) {
        this.previewing = false;
        this.onPreview(undefined);
      }
      this.at++;
    }
    this.unlisten?.();
    this.unlisten = undefined;
    this.set({ ...this.snap, phase: "done" });
    // The last note stays a moment. Then the cursor flies back beside his own mouse, as
    // Clicky's does, and fades there.
    await sleep(1800);
    if (!live()) return;
    this.set({ ...this.snap, note: undefined, mark: undefined });
    const home = this.mouse ?? { x: this.view().width - 60, y: this.view().height * 0.4 };
    await this.player?.moveTo(
      { x: Math.min(home.x + 22, this.view().width - 30), y: home.y + 18 },
      { params: { style: "signature_arc", timing: "fitts" }, reducedMotion: this.settings.reduced },
    );
    await sleep(400);
    if (live() && this.snap.phase === "done") this.set({ ...this.snap, shown: false });
  }

  private find(beat: Beat): Element | undefined {
    const element = document.querySelector(beat.target);
    if (element === null) return undefined;
    const rect = element.getBoundingClientRect();
    return rect.width === 0 && rect.height === 0 ? undefined : element;
  }

  private goneWords(beat: Beat) {
    return `I can't find ${beat.name ?? "what I wanted to show"} any more. It moved, or the page changed.`;
  }

  private inView(element: Element) {
    const r = element.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= this.view().height;
  }

  /** Waits for the reviewer's own click on the element, or a skip. The click goes to the page
   * as any click does. */
  private turn(element: Element) {
    return new Promise<void>((resolve) => {
      const done = () => {
        element.removeEventListener("click", done, true);
        this.turned = undefined;
        resolve();
      };
      element.addEventListener("click", done, true);
      this.turned = done;
    });
  }

  /**
   * Watches the beat's element while it shows: a scroll, a resize, a change of layout or of
   * the DOM checks it again. A moved element moves the cursor, its mark and its note; an
   * element that is gone, or no longer the one the selector finds, stops the walk.
   */
  private track(beat: Beat, element: Element, generation: number, onMove: (box: Box) => void) {
    let last = boxOf(element.getBoundingClientRect());
    let frame = 0;
    const check = () => {
      frame = 0;
      if (generation !== this.generation) return;
      const now = document.querySelector(beat.target);
      if (now === null || now !== element || !element.isConnected)
        return this.lose(this.goneWords(beat));
      const box = boxOf(element.getBoundingClientRect());
      if (box.width === 0 && box.height === 0) return this.lose(this.goneWords(beat));
      if (!moved(box, last)) return;
      last = box;
      void this.player?.moveTo(aim(box, this.view()).tip, {
        params: { style: "spring_settle", timing: "fixed" },
        target: [box.left, box.top, box.width, box.height],
        reducedMotion: this.settings.reduced,
      });
      onMove(box);
    };
    const soon = () => {
      if (frame === 0) frame = requestAnimationFrame(check);
    };
    const resize = new ResizeObserver(soon);
    resize.observe(element);
    const dom = new MutationObserver(soon);
    dom.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("scroll", soon, true);
    window.addEventListener("resize", soon);
    this.untrack = () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      dom.disconnect();
      window.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
    };
  }

  /** Escape, one level at a time: a walk that runs pauses, and one that waits stops. A change
   * of page loses the walk. */
  private listen() {
    if (this.unlisten !== undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (this.active()) this.pause();
      else this.stop();
    };
    // The mouse is only noted, for the cursor to come back to.
    const onMove = (e: PointerEvent) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    };
    const onPage = () => this.lose("The page changed, so I stopped here.");
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("popstate", onPage);
    window.addEventListener("hashchange", onPage);
    this.unlisten = () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("popstate", onPage);
      window.removeEventListener("hashchange", onPage);
    };
  }
}
