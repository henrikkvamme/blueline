import type { Beat, Shape } from "../../queue/queue";
import { MotionPlayer } from "../../vendor/cua-cursor-motion.js";
import { clean } from "./markup";
import { fetchLine, hush, say } from "./voice";

/*
 * The agent's cursor as a controller: it walks a remark's beats, and the reviewer always wins.
 *
 * - It yields on request, as Clicky does. Escape pauses it and stops its voice at once; a
 *   second Escape dismisses it; Space pauses and goes on. Nothing else pauses it: he moves,
 *   clicks, scrolls and types while it speaks, and it never fights him for the page.
 * - It never trusts old coordinates. While a beat shows, it watches its element through
 *   scroll, resize, layout and DOM changes. A moved element takes the cursor with it; an
 *   element that is gone, or a page that changed, stops the walk with a reason.
 * - It shows more than it does. A beat can preview a variant or mock up a change, which ends
 *   with the beat. A beat that is the reviewer's turn waits for his own click; only a beat
 *   that shows him a journey clicks, once it has said what it does.
 *
 * It draws and notes rather than writes, as Clicky does. The voice says the whole line. On the
 * page, the cursor draws on the element (a loop, a line, a box, a frame for a turn, or shapes
 * of its own, such as arrows), and a note beside it holds a few words. With the voice off, the note holds the whole line too.
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
  readonly left?: number;
  readonly right?: number;
  readonly top?: number;
  readonly bottom?: number;
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** What the cursor draws on an element: a loop round it, a line under it, a box round it, a
 * line through it, the frame of the reviewer's turn, or the ring of its own click. */
export type Draw = "circle" | "underline" | "box" | "strike" | "frame" | "press";

export interface Mark {
  readonly draw: Draw | undefined;
  readonly box: Box;
  /** The beat's own shapes, placed against the box. */
  readonly shapes: readonly Shape[];
  /** A new key draws a new mark; the same key follows its element. */
  readonly key: string;
}

/** The agent's note beside the element, in the look of an annotation. */
export interface Note {
  readonly tone: "say" | "turn" | "paused" | "lost";
  /** What its dot says: the beat's number from 1, or the beat's own label. */
  readonly step: string;
  /** A few words. */
  readonly words: string;
  /** The whole line, when no voice says it. */
  readonly line: string | undefined;
  readonly place: Place;
  /** A new key comes in as a new note. */
  readonly key: string;
}

/** Where a mock-up shows: the page itself holds the change, and this frames it. */
export interface Mock {
  readonly box: Box;
  readonly key: string;
}

export interface Snapshot {
  readonly phase: Phase;
  /** The beat that shows, and how many there are. */
  readonly beat: number;
  readonly beats: number;
  readonly note: Note | undefined;
  readonly mark: Mark | undefined;
  readonly mock: Mock | undefined;
  /** Which walk this is: each start makes a new one. */
  readonly run: number;
  /** Whether the cursor is on the screen. */
  readonly shown: boolean;
  readonly skipped: boolean;
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
  // An element in the panel, the agent's drawing board: the cursor points at its left edge
  // from the page, and the note stands on the page beside it.
  if (rect.left >= view.width - 4) {
    const tip = { x: rect.left - 2, y: rect.top + Math.min(rect.height / 2, 18) };
    const place: Place = { right: innerWidth - tip.x + NOTE.gap + 6, top: tip.y - 14 };
    return { tip, place };
  }
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
  mock: undefined,
  run: 0,
  shown: false,
  skipped: false,
};

/** Swaps words in the element's own text and fields, in place, so the page lays them out as
 * it would its own. It gives back the undo. */
function swapInPlace(
  element: Element,
  swap: readonly { readonly from: string; readonly to: string }[],
) {
  const change = (words: string) =>
    swap.reduce((text, { from, to }) => (from === "" ? text : text.split(from).join(to)), words);
  const undo: (() => void)[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node;
    const was = text.nodeValue ?? "";
    const now = change(was);
    if (now === was) continue;
    text.nodeValue = now;
    undo.push(() => {
      if (text.nodeValue === now) text.nodeValue = was;
    });
  }
  const fields = [element, ...element.querySelectorAll("input, textarea")].filter(
    (field) => field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement,
  );
  for (const field of fields) {
    const was = field.value;
    const now = change(was);
    if (now === was) continue;
    undo.push(holdValue(field, was, now));
  }
  return () => undo.forEach((step) => step());
}

/** Holds a field at the mock-up's value while the app renders: React writes its own value back
 * to a controlled field, and the hold turns that write into the mock-up's. */
function holdValue(field: HTMLInputElement | HTMLTextAreaElement, was: string, now: string) {
  const own = Object.getOwnPropertyDescriptor(field, "value");
  const proto: object = Object.getPrototypeOf(field);
  Object.defineProperty(field, "value", {
    configurable: true,
    get: () => String(Reflect.get(proto, "value", field)),
    set: (value: string) => {
      Reflect.set(proto, "value", value === was ? now : value, field);
    },
  });
  field.value = now;
  return () => {
    if (own === undefined) Reflect.deleteProperty(field, "value");
    else Object.defineProperty(field, "value", own);
    if (field.value === now) field.value = was;
  };
}

/** Puts the agent's markup in the element's place, in the page itself, so the page's own
 * styles and layout hold. It gives back the part to frame and the undo. */
function placeInstead(element: Element, html: string) {
  const holder = document.createElement("div");
  holder.style.display = "contents";
  holder.innerHTML = clean(html);
  holder.querySelectorAll("[data-q]").forEach((part) => part.removeAttribute("data-q"));
  element.after(holder);
  const hidden = element instanceof HTMLElement ? element.style.display : undefined;
  if (element instanceof HTMLElement) element.style.display = "none";
  return {
    framed: holder.firstElementChild ?? holder,
    undo: () => {
      holder.remove();
      if (element instanceof HTMLElement && hidden !== undefined) element.style.display = hidden;
    },
  };
}

function textInstead(element: Element, text: string) {
  const copy = element.cloneNode(false);
  if (!(copy instanceof HTMLElement)) return undefined;
  copy.textContent = text;
  return copy.outerHTML;
}

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
  /** Shows the element that a mock-up hid. */
  private unhide: (() => void) | undefined;
  /** When the cursor last clicked: a page that changes after it is the click's doing. */
  private clicked = 0;
  /** What the cursor holds on, from his release until the agent's first walk. */
  private holding: { readonly words: string; readonly key: string } | undefined;

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
    if (walk.length === 0) return this.set({ ...IDLE, run: this.snap.run + 1 });
    this.set({ ...IDLE, beats: walk.length, run: this.snap.run + 1, shown: true });
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

  /** He speaks to the agent: the walk pauses, and the cursor and its note give way to the
   * waveform at his own mouse, as Clicky's do. Space goes on from where it stopped. */
  attend() {
    this.pause();
    this.set({ ...this.snap, shown: false, note: undefined, mark: undefined });
  }

  /** Puts the cursor at a point, for the next walk to start from there: where he spoke. */
  from(point: { readonly x: number; readonly y: number }) {
    this.player?.place(point);
  }

  /**
   * He let go of the keys: at once, the cursor flies from his mouse to what he meant and
   * circles it, with his words in its note, as Clicky's does. It holds there, with no voice,
   * until the agent's first walk takes over (`start`), the fast line comes (`hearing`), or the
   * agent ends with nothing to show (`unhold`). The agent's answer takes seconds; this shows
   * in the first frame that it heard him.
   */
  hold(target: string, words: string) {
    this.halt();
    this.walk = [];
    this.at = 0;
    const generation = this.generation;
    const beat: Beat = { target, say: words };
    const element = this.find(beat);
    if (element === undefined) return;
    const key = `hold-${String(generation)}`;
    this.holding = { words, key };
    this.set({ ...IDLE, run: this.snap.run, phase: "moving", shown: true });
    const rect = boxOf(element.getBoundingClientRect());
    void this.player
      ?.moveTo(aim(rect, this.view()).tip, {
        params: { style: "signature_arc", timing: "fitts" },
        target: [rect.left, rect.top, rect.width, rect.height],
        reducedMotion: this.settings.reduced,
      })
      .then(() => {
        if (generation !== this.generation) return;
        this.element = element;
        this.showHold(boxOf(element.getBoundingClientRect()));
        this.track(beat, element, generation, (box) => this.showHold(box));
      });
  }

  /** The fast line came: the held note says it. */
  hearing(words: string) {
    if (this.holding === undefined) return;
    this.holding = { ...this.holding, words };
    const box = this.snap.mark?.box;
    if (box !== undefined) this.showHold(box);
  }

  /** The agent ended with no walk of its own: the held cursor goes. */
  unhold() {
    if (this.holding === undefined) return;
    this.stop();
  }

  private showHold(box: Box) {
    const held = this.holding;
    if (held === undefined) return;
    this.set({
      ...this.snap,
      phase: "speaking",
      mark: { draw: "circle", box, shapes: [], key: held.key },
      note: {
        tone: "say",
        step: "",
        words: held.words,
        line: undefined,
        place: aim(box, this.view()).place,
        key: held.key,
      },
    });
  }

  /** Go on from the beat it stopped at, after a pause or a lost element. */
  resume() {
    if (this.snap.phase !== "paused" && this.snap.phase !== "lost") return;
    this.halt();
    this.set({ ...this.snap, phase: "moving", note: undefined, mark: undefined, shown: true });
    void this.play(this.generation);
  }

  /** Escape: the walk ends, its voice stops, and the cursor goes. */
  stop() {
    this.halt();
    this.unlisten?.();
    this.unlisten = undefined;
    this.set({ ...IDLE, beats: this.walk.length, run: this.snap.run });
  }

  /** The reviewer skips his turn. */
  skip() {
    if (this.turned === undefined) return;
    this.set({ ...this.snap, skipped: true });
    this.turned();
  }

  /** The page that shows. A click of the walk's own, or of his turn, goes on with the walk;
   * a page he opens himself ends it, quietly, as he chose to go there. */
  navigate(path: string) {
    if (path === this.path) return;
    this.path = path;
    const ours = Date.now() - this.clicked < 1500;
    if (this.active() && !ours) this.stop();
  }

  /** The element the walk waits for him to click, during a turn. */
  turnTarget() {
    return this.snap.phase === "turn" ? this.walk[this.at]?.target : undefined;
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

  /** Ends the running loop, its voice, its watchers, and its preview and mock-up unless
   * `keep`. Escape
   * still reaches the walker until it stops. */
  private halt(keep = false) {
    this.generation++;
    this.holding = undefined;
    hush();
    this.turned = undefined;
    this.untrack?.();
    this.untrack = undefined;
    // A mock-up stays with a pause, as a preview does: he may speak about it.
    if (!keep) {
      this.unhide?.();
      this.unhide = undefined;
      if (this.snap.mock !== undefined) this.snap = { ...this.snap, mock: undefined };
    }
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
        step: String(this.at + 1),
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
      const shapes = beat.shapes ?? [];
      const framed = beat.replace === undefined ? undefined : this.mockUp(element, beat.replace);
      const shown = framed === undefined ? rect : boxOf(framed.getBoundingClientRect());
      const voice = this.settings.voice;
      // With no voice, the note holds the whole line, so nothing that is said is lost.
      const words = beat.note ?? beat.say;
      const line = (heard: boolean) => (heard || words === beat.say ? undefined : beat.say);
      const show = (box: Box, heard: boolean) =>
        this.set({
          ...this.snap,
          phase: turn ? "turn" : "speaking",
          mark: draw === undefined && shapes.length === 0 ? undefined : { draw, box, shapes, key },
          mock: framed === undefined ? undefined : { box, key },
          note: {
            tone: turn ? "turn" : "say",
            step: beat.label ?? String(this.at + 1),
            words,
            line: line(heard),
            place: aim(box, this.view()).place,
            key,
          },
        });
      let last = shown;
      let heard = voice !== undefined;
      show(shown, heard);
      this.element = element;
      this.track(
        beat,
        element,
        generation,
        (box) => {
          last = box;
          show(box, heard);
        },
        framed,
      );
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
      if (!live()) return;
      this.untrack?.();
      this.untrack = undefined;
      if (beat.click === true && element.isConnected) {
        // It said what it does; now it does it, with a ring where it clicks.
        this.unhide?.();
        this.unhide = undefined;
        this.set({
          ...this.snap,
          mock: undefined,
          mark: { draw: "press", box: last, shapes: [], key: `${key}-press` },
        });
        await sleep(this.settings.reduced ? 0 : 160);
        if (!live()) return;
        this.clicked = Date.now();
        if (element instanceof HTMLElement) element.click();
        await sleep(650);
      } else await sleep(350);
      if (!live()) return;
      this.unhide?.();
      this.unhide = undefined;
      if (this.snap.mock !== undefined) this.set({ ...this.snap, mock: undefined });
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
    this.set({ ...this.snap, note: undefined, mark: undefined, mock: undefined });
    const home = this.mouse ?? { x: this.view().width - 60, y: this.view().height * 0.4 };
    await this.player?.moveTo(
      { x: Math.min(home.x + 22, this.view().width - 30), y: home.y + 18 },
      { params: { style: "signature_arc", timing: "fitts" }, reducedMotion: this.settings.reduced },
    );
    await sleep(400);
    if (live() && this.snap.phase === "done") this.set({ ...this.snap, shown: false });
  }

  /** Shows the change in the page itself, and gives back the part to frame. */
  private mockUp(element: Element, replace: NonNullable<Beat["replace"]>) {
    const html =
      replace.html ?? (replace.text === undefined ? undefined : textInstead(element, replace.text));
    const swap = replace.swap ?? [];
    if (swap.length === 0 && html === undefined) return undefined;
    const placed =
      swap.length > 0 || html === undefined
        ? { framed: element, undo: swapInPlace(element, swap) }
        : placeInstead(element, html);
    placed.framed.setAttribute("data-mock-shows", "");
    this.unhide = () => {
      placed.framed.removeAttribute("data-mock-shows");
      placed.undo();
    };
    return placed.framed;
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
        // His click may change the page, as the turn asked.
        this.clicked = Date.now();
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
  private track(
    beat: Beat,
    element: Element,
    generation: number,
    onMove: (box: Box) => void,
    framed: Element = element,
  ) {
    let last = boxOf(framed.getBoundingClientRect());
    let frame = 0;
    const check = () => {
      frame = 0;
      if (generation !== this.generation) return;
      const now = document.querySelector(beat.target);
      if (now === null || now !== element || !element.isConnected || !framed.isConnected) {
        // A new page takes the element first; the page's own news then ends the walk quietly.
        window.setTimeout(() => {
          if (generation === this.generation) this.lose(this.goneWords(beat));
        }, 200);
        return;
      }
      const box = boxOf(framed.getBoundingClientRect());
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
    resize.observe(framed);
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
    const onPage = () => this.stop();
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
