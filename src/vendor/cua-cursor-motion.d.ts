//#endregion
//#region src/geom.d.ts
/** A point in screen space (points, y down). */
interface Pt {
  x: number;
  y: number;
}
/** Target rect `[x, y, width, height]`. */
type Rect = [number, number, number, number];
declare const pt: (x: number, y: number) => Pt;
declare const dist: (a: Pt, b: Pt) => number;
declare const lerp: (a: number, b: number, t: number) => number;
declare const lerpPt: (a: Pt, b: Pt, t: number) => Pt;
declare const clamp: (v: number, lo: number, hi: number) => number;
declare function unit(a: Pt, b: Pt): Pt;
/** 90 degrees counter-clockwise in screen space (y down). */
declare const perp: (u: Pt) => Pt;
/** Wrap an angle into `(-PI, PI]`. */
declare function wrapAngle(a: number): number;
/**
 * Distance from the cursor's hotspot (the tip) to its anchor (the body),
 * along the heading, in points.
 */
declare const POINTER_ANCHOR_OFFSET = 16;
/** Anchor (body point) that places the hotspot on `(x, y)` at `heading`. */
declare function anchorForPointer(x: number, y: number, heading: number): [number, number];
/** Hotspot for an anchor at `heading`. */
declare function pointerForAnchor(x: number, y: number, heading: number): [number, number];
//#endregion
//#region src/rng.d.ts
/** FNV-1a over UTF-16 code units. */
declare function hashString(text: string): number;
/** mulberry32, bit-identical to the Rust crate and the motion lab. */
declare class Rng {
  private state;
  constructor(seed: string);
  next(): number;
  range(lo: number, hi: number): number;
}
//#endregion
//#region src/ease.d.ts
/** Speed curves: how far along the path the cursor is at each moment. */
type EaseName = 'linear' | 'min_jerk' | 'smootherstep' | 'in_out_cubic' | 'in_out_sine' | 'out_cubic';
type Ease = EaseName | {
  type: EaseName;
} | {
  type: 'cubic_bezier';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
declare const EASE_NAMES: EaseName[];
declare const linear: (t: number) => number;
/** Minimum-jerk: the profile of a relaxed human reach. */
declare const minJerk: (t: number) => number;
declare const smootherstep: (t: number) => number;
declare const inOutCubic: (t: number) => number;
declare const inOutSine: (t: number) => number;
declare const outCubic: (t: number) => number;
/** CSS-style `cubic-bezier(x1, y1, x2, y2)`. */
declare function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number;
/** The function behind an `Ease` value. */
declare function easeFn(ease: Ease): (t: number) => number;
/** Base plus a smooth bump that pushes `over` past the end, peaking at `overAt`. */
declare function bumpProfile(base: (t: number) => number, over: number, overAt: number): (tau: number) => number;
/** Damped wobble around the end from `start` on. */
declare function wobbleProfile(base: (t: number) => number, amp: number, cycles: number, decay: number, start: number): (tau: number) => number;
//#endregion
//#region src/path.d.ts
/** A parametric path with an arc-length table, so speed curves act on distance. */
declare class Path {
  private readonly f;
  readonly length: number;
  private readonly us;
  private readonly ss;
  private readonly p0;
  private readonly p1;
  private readonly t0;
  private readonly t1;
  constructor(f: (u: number) => Pt, n: number);
  /** The point `frac` of the way along by distance; extrapolates past the ends. */
  atFraction(frac: number): Pt;
}
/** Arc knobs of the Cua bezier. */
interface ArcShape {
  /** First control point's distance from the start, fraction of the chord. [0, 1] */
  startHandle: number;
  /** Second control point's distance from the end. [0, 1] */
  endHandle: number;
  /** Sideways bend, fraction of the chord; the sign picks the side. */
  arcSize: number;
  /** Where the bend peaks: -1 near the start, +1 near the end. */
  arcFlow: number;
}
/** The Cua bezier as a path. */
declare function cuaPath(a: Pt, b: Pt, shape: ArcShape): Path;
/** Gentle single-sided quadratic curve. */
declare function bowPath(a: Pt, b: Pt, amount: number): Path;
declare const straightPath: (a: Pt, b: Pt) => Path;
/** Chord side that bends paths upward for horizontal moves. */
declare const naturalSide: (a: Pt, b: Pt) => number;
//#endregion
//#region src/dubins.d.ts
/** Dubins arc-straight-arc planner of the `classic` glide (port of `dubins.rs`). */
interface PathState {
  x: number;
  y: number;
  heading: number;
}
interface PlannedPath {
  length: number;
  sample(distance: number): PathState;
}
/** Plan a Dubins path from `(x0, y0)` heading `th0` to `(x1, y1)` heading `th1`. */
declare function planDubins(x0: number, y0: number, th0: number, x1: number, y1: number, th1: number, turnRadius: number): PlannedPath;
//#endregion
//#region src/style.d.ts
/** The six built-in styles, as Cua Driver names them. */
type MotionStyle = 'signature_arc' | 'spring_settle' | 'magnetic' | 'comet_swoop' | 'adaptive' | 'classic';
declare const MOTION_STYLES: MotionStyle[];
/**
 * `native` (the style's own), `fitts` or `fixed`; `relaxed`, `steady` and `calm` keep the
 * style's timing with a 450, 600 or 750 ms floor and a sine ease; `deliberate` is Fitts with
 * a 400 ms constant, 450..1300 ms.
 */
type MotionTiming = 'native' | 'fitts' | 'fixed' | 'relaxed' | 'steady' | 'calm' | 'deliberate';
declare const MOTION_TIMINGS: MotionTiming[];
/** Minimum move time of the floor timings, or `null`. */
declare function timingFloorMs(timing: MotionTiming): number | null;
type EffectName = 'trail' | 'glow' | 'magnet' | 'ripple' | 'squish';
declare const EFFECT_NAMES: EffectName[];
/** Effects that are on or off. */
type ResolvedEffects = Record<EffectName, boolean>;
/** Per-effect overrides; unset or `null` keeps the style's default. */
type MotionEffects = Partial<Record<EffectName, boolean | null>>;
declare const NO_EFFECTS: ResolvedEffects;
/** Effects a style turns on when the caller leaves them unset. */
declare function defaultEffects(style: MotionStyle): ResolvedEffects;
declare function resolveEffects(overrides: MotionEffects | undefined, base: ResolvedEffects): {
  trail: boolean;
  glow: boolean;
  magnet: boolean;
  ripple: boolean;
  squish: boolean;
};
/** Fixed-timing duration when `glideDurationMs` is 0. */
declare const DEFAULT_FIXED_MS = 1430;
//#endregion
//#region src/params.d.ts
/** Knobs of the built-in styles. Defaults match Cua Driver. */
interface MotionParams {
  style: MotionStyle;
  timing: MotionTiming;
  effects: MotionEffects;
  /** Control-point offset from the start, fraction of the distance. [0, 1] */
  startHandle: number;
  /** Control-point offset from the end. [0, 1] */
  endHandle: number;
  /** Arc scale: 0.25 keeps each style's own arc, 0 is straight. [0, 1] */
  arcSize: number;
  /** Shift of the arc's peak: positive = apex near the destination. [-1, 1] */
  arcFlow: number;
  /** `classic` arrival spring damping: 1 = critical, 0.3 = bouncy. */
  spring: number;
  /** Fixed move time in ms (0 = 1430 for `fixed` timing; > 0 with `native` also fixes it). */
  glideDurationMs: number;
  /** `classic` peak speed, pt/s. */
  peakSpeed: number;
  /** `classic` speed floor at the start, pt/s. */
  minStartSpeed: number;
  /** `classic` speed floor at the end, pt/s. */
  minEndSpeed: number;
  /** `classic` minimum turning radius, pt. */
  turnRadius: number;
}
declare const DEFAULT_PARAMS: Readonly<MotionParams>;
declare const motionParams: (p?: Partial<MotionParams>) => MotionParams;
declare const resolvedEffects: (p: MotionParams) => ResolvedEffects;
//#endregion
//#region src/plan.d.ts
/** Sample period of every planned trajectory, ms (120 Hz). */
declare const DT_MS: number;
/** Target box assumed when a move has no element rect. */
declare const DEFAULT_TARGET_PT = 24;
/** The arrow's rest heading: pointing up and to the left. */
declare const REST_HEADING: number;
/** One sample: seconds from the start, the hotspot, and the arrow's heading. */
interface Sample {
  t: number;
  x: number;
  y: number;
  heading: number;
}
interface MoveRequest {
  /** Current hotspot. */
  from: Pt;
  /** Requested hotspot. */
  to: Pt;
  /** Current heading; defaults to the rest heading. */
  fromHeading?: number;
  /** Rest heading on arrival; defaults to pi/4. */
  endHeading?: number;
  /** Target element rect, if known. It sets the Fitts width. */
  target?: Rect | null;
  /** Same seed, same motion (only `adaptive` draws from it). */
  seed?: string;
  /** A short straight glide without effects. */
  reducedMotion?: boolean;
}
/** Global Fitts timing: `150 + 120 log2(D / W + 1)` ms, 300..1000. */
declare function fittsTimingMs(d: number, w: number): number;
/** `deliberate` timing: `400 + 120 log2(D / W + 1)` ms, 450..1300. */

/** A planned move, played back by time. */
declare class Trajectory {
  readonly samples: Sample[];
  /** When the tip first reaches the target (within 1 pt), seconds. */
  readonly arrivalT: number;
  /** Magnetic lock-on time, seconds. */
  readonly snapT: number | null;
  readonly target: Rect;
  readonly targetKnown: boolean;
  readonly effects: ResolvedEffects;
  readonly trail: TrailSpec;
  /** The built-in style, or `null` for a custom spec. */
  readonly style: MotionStyle | null;
  constructor(samples: Sample[], /** When the tip first reaches the target (within 1 pt), seconds. */
  arrivalT: number, /** Magnetic lock-on time, seconds. */
  snapT: number | null, target: Rect, targetKnown: boolean, effects: ResolvedEffects, trail: TrailSpec, /** The built-in style, or `null` for a custom spec. */
  style: MotionStyle | null);
  duration(): number;
  end(): Sample;
  /** Interpolated sample at `t` seconds, clamped to the ends. */
  sampleAt(t: number): Sample;
  /** Hotspot velocity at `t`, pt/s. */
  velocityAt(t: number): [number, number];
}
/** Plan one move for a built-in style. Unset params take Cua Driver's defaults. */
declare function planMove(params: Partial<MotionParams>, req: MoveRequest): Trajectory;
/** Plan one move for a custom spec. */
declare function planSpec(spec: MotionSpec, req: MoveRequest): Trajectory;
declare namespace effects_d_exports {
  export { CLICK_FX_SECS, DEFAULT_TRAIL, EffectFrame, Glow, MAGNET_INFLATE, MAGNET_SECS, Magnet, RIPPLE_SECS, Ripple, SQUISH, TrailSeg, TrailSpec, addClick, effectRgb, emptyFrame, glow, linger, magnet, motionFrame, ripple, squish, trail };
}
interface TrailSpec {
  /** How far back in time the trail reaches, seconds. */
  secs: number;
  /** Path length (pt) at which the trail reaches full strength. */
  fadeLen: number;
  /** Segments. */
  steps: number;
  /** Stroke width at the tail and the head, pt. */
  tailWidth: number;
  headWidth: number;
  /** Opacity at the head; falls off with the square of the position. */
  alpha: number;
  /** How far behind the tip, along the arrow's axis, the trail starts, pt. */
  anchorOffset: number;
}
declare const DEFAULT_TRAIL: Readonly<TrailSpec>;
declare const MAGNET_SECS = 0.7;
declare const MAGNET_INFLATE = 6;
declare const RIPPLE_SECS = 0.52;
declare const CLICK_FX_SECS = 0.55;
declare const SQUISH = 0.12;
interface Glow {
  x: number;
  y: number;
  r: number;
  alpha: number;
}
interface TrailSeg {
  a: [number, number];
  b: [number, number];
  width: number;
  alpha: number;
}
interface Magnet {
  rect: Rect;
  glow: number;
}
interface Ripple {
  x: number;
  y: number;
  r: number;
  width: number;
  alpha: number;
}
interface EffectFrame {
  glow: Glow | null;
  trail: TrailSeg[];
  magnet: Magnet | null;
  ripple: Ripple | null;
  /** Scale-down of the cursor, 0 = none. */
  squish: number;
}
declare const emptyFrame: () => EffectFrame;
/** Speed glow at `t` around `pos` (the cursor's anchor). */
declare function glow(traj: Trajectory, t: number, pos: [number, number]): Glow | null;
/** Comet trail at `t`, tail first, following the arrow's body. */
declare function trail(traj: Trajectory, t: number): TrailSeg[];
/** Magnet glow at `t`, after a lock-on. */
declare function magnet(traj: Trajectory, t: number): Magnet | null;
/** Click ripple `age` seconds after a click at `point`. */
declare function ripple(age: number, point: [number, number]): Ripple | null;
/** Click squish `age` seconds after a click. */
declare function squish(age: number): number;
/** The move's effects at `t`. `pos` is the anchor; `blend` = can draw translucency. */
declare function motionFrame(traj: Trajectory, t: number, pos: [number, number], blend?: boolean): EffectFrame;
/** Add the click effects `age` seconds after a click at `point`. */
declare function addClick(frame: EffectFrame, effects: ResolvedEffects, age: number, point: [number, number]): void;
/** When a finished trajectory can be dropped (trail caught up, magnet faded). */
declare function linger(traj: Trajectory): number;
/** Effect colour: the cursor fill lifted toward white. */
declare function effectRgb(fill: [number, number, number]): [number, number, number];
//#endregion
//#region src/spec.d.ts
/** Path shape. A positive arc or bow bends to the natural side (up for horizontal moves). */
type PathShape = {
  type: 'straight';
} | ({
  type: 'arc';
} & ArcShape) | {
  type: 'bow';
  amount: number;
};
/** What happens at the end of the glide. */
type Settle = {
  type: 'none';
}
/** Push `amount` of the distance (at most `maxPt`) past the target, peaking at `at`, and return. */ | {
  type: 'follow_through';
  amount: number;
  maxPt: number;
  at: number;
}
/** Reach the target by `glideEnd`, then a damped wobble from `start` on. */ | {
  type: 'spring';
  amount: number;
  maxPt: number;
  cycles: number;
  decay: number;
  start: number;
  glideEnd: number;
};
/** How long the move takes. */
type Duration = {
  type: 'fixed';
  ms: number;
}
/** `(a + b log2(D / W + 1)).clamp(minMs, maxMs) * scale`; W = target's smaller side (>= 4). */ | {
  type: 'fitts';
  a: number;
  b: number;
  minMs: number;
  maxMs: number;
  scale: number;
}
/** `(baseMs + msPerPt * D).clamp(minMs, maxMs)`. */ | {
  type: 'distance';
  baseMs: number;
  msPerPt: number;
  minMs: number;
  maxMs: number;
};
/** `tangent`: the tip leads the motion. `fixed`: the arrow keeps its rest pose. */
type Heading = 'tangent' | 'fixed';
/** A complete custom motion. */
interface MotionSpec {
  path: PathShape;
  ease: Ease;
  settle: Settle;
  duration: Duration;
  heading: Heading;
  effects: ResolvedEffects;
  trail: TrailSpec;
}
/** The Fitts model the director's-cut styles share. */
declare const fittsDuration: (scale: number) => Duration;
declare function durationMs(d: Duration, distance: number, width: number): number;
/** Scale a style's own arc by the `arcSize` knob and shift its flow by `arcFlow`. */
declare function knobShape(params: MotionParams, arcSize: number, arcFlow: number): ArcShape;
/**
 * The spec behind a built-in style. `magnetic`, `adaptive` and `classic` are
 * simulations rather than specs and return `null`.
 */
declare function specForStyle(style: MotionStyle, params?: Partial<MotionParams>): MotionSpec | null;
/** `signature_arc` as a spec: a good starting point for your own. */
declare const defaultSpec: () => MotionSpec;
//#endregion
//#region src/render.d.ts
/**
 * The Cua Driver cursor body (`cursor-overlay/assets/build_default_theme.py`
 * `CURSOR_PATH`) on its 128-unit canvas, hotspot at (55, 30).
 */
declare const CURSOR_PATH = "M55 30 C48 28 42 33 43 41 C43 41 64 98 64 98 C67 106 73 106 77 99 C77 99 86 79 86 79 C88 75 91 72 95 70 C95 70 108 63 108 63 C115 59 114 53 107 50 C107 50 55 30 55 30 Z";
declare const CURSOR_HOTSPOT: Pt;
/** On-screen size of the 128-unit cursor canvas, pt (Cua Driver's `DISPLAY_SIZE`). */
declare const CURSOR_DISPLAY_SIZE = 42;
/** Cua blue, the default cursor fill. */
declare const CUA_BLUE = "#5ec0e8";
interface CursorStyle {
  /** Body fill. Default Cua blue. */
  fill?: string;
  /** Scale on top of the 42 pt display size. */
  scale?: number;
  /** Click squish, 0..1 of the size. */
  squish?: number;
  alpha?: number;
  /** Seconds into the driver's gentle float (it restarts with each move), or null for none. */
  floatT?: number | null;
}
/** Draw the Cua cursor with its tip on `(x, y)`, rotated to `heading` (rest = pi/4). */
declare function drawCursor(g: CanvasRenderingContext2D, x: number, y: number, heading: number, style?: CursorStyle): void;
/** Paint the effects that sit under the cursor: glow, trail, magnet. */
declare function drawEffectsUnder(g: CanvasRenderingContext2D, f: EffectFrame, fill?: string): void;
/** Paint the click ripple, which sits over the cursor. */
declare function drawEffectsOver(g: CanvasRenderingContext2D, f: EffectFrame, fill?: string): void;
interface MoveOptions {
  /** A built-in style and its knobs. */
  params?: Partial<MotionParams>;
  /** Or a custom motion. */
  spec?: MotionSpec;
  /** Target rect, for Fitts timing and the magnet glow. */
  target?: Rect | null;
  /** Click on arrival (ripple and squish when the motion has them). */
  click?: boolean;
  reducedMotion?: boolean;
}
interface PlayerOptions {
  fill?: string;
  /** Called before the cursor each frame, in canvas points; draw your scene here. */
  drawScene?: (g: CanvasRenderingContext2D, player: MotionPlayer) => void;
  /** The driver's gentle float. Default true. */
  float?: boolean;
}
/**
 * Plays motions on a canvas. Coordinates are CSS pixels of the canvas.
 *
 * ```ts
 * const player = new MotionPlayer(canvas);
 * player.place({ x: 80, y: 80 });
 * await player.moveTo({ x: 600, y: 320 }, { params: { style: 'comet_swoop' }, click: true });
 * ```
 */
declare class MotionPlayer {
  readonly canvas: HTMLCanvasElement;
  readonly options: PlayerOptions;
  /** Hotspot. */
  pos: Pt;
  heading: number;
  trajectory: Trajectory | null;
  /** Playback speed; 0.25 plays at quarter speed. */
  timeScale: number;
  private motionT;
  private arrival;
  private clickAge;
  private clickPoint;
  private clickEffects;
  private pendingClick;
  private idleT;
  private last;
  private raf;
  private moves;
  private readonly g;
  constructor(canvas: HTMLCanvasElement, options?: PlayerOptions);
  /** Put the cursor at rest on `p` without motion. */
  place(p: Pt): void;
  /** Move to `to`; resolves when the tip arrives (any settle keeps playing). */
  moveTo(to: Pt, opts?: MoveOptions): Promise<void>;
  /** Show a click at the current tip. */
  click(effects?: ResolvedEffects): void;
  destroy(): void;
  private frame;
  private tick;
  /** Effects at the current moment. */
  effectFrame(): EffectFrame;
  private paint;
}
//#endregion
//#region src/driver.d.ts
interface DriverSnippets {
  /** Saved default for new sessions (style, timing, effects only). */
  configSet: string[];
  /** One session, from the shell. */
  cursorMotion: string;
  /** The `set_agent_cursor_motion` arguments, including the shape knobs. */
  setAgentCursorMotion: Record<string, unknown>;
  /** Knobs the saved default and the shell command cannot carry. */
  callOnly: string[];
}
/** Cua Driver equivalents of built-in style params. */
declare function driverSnippets(params: Partial<MotionParams>, session?: string): DriverSnippets;
/** TypeScript for planning these params with `@trycua/cursor-motion`. */
declare function paramsSnippet(params: Partial<MotionParams>): string;
/** TypeScript for a custom spec. */
declare function specSnippet(spec: MotionSpec): string;
//#endregion
export { type ArcShape, CUA_BLUE, CURSOR_DISPLAY_SIZE, CURSOR_HOTSPOT, CURSOR_PATH, CursorStyle, DEFAULT_FIXED_MS, DEFAULT_PARAMS, DEFAULT_TARGET_PT, DEFAULT_TRAIL, DT_MS, DriverSnippets, Duration, EASE_NAMES, EFFECT_NAMES, Ease, EaseName, type EffectFrame, EffectName, type Glow, Heading, MOTION_STYLES, MOTION_TIMINGS, type Magnet, MotionEffects, MotionParams, MotionPlayer, MotionSpec, MotionStyle, MotionTiming, MoveOptions, type MoveRequest, NO_EFFECTS, POINTER_ANCHOR_OFFSET, Path, PathShape, type PathState, type PlannedPath, PlayerOptions, Pt, REST_HEADING, Rect, ResolvedEffects, type Ripple, Rng, type Sample, Settle, type TrailSeg, type TrailSpec, Trajectory, anchorForPointer, bowPath, bumpProfile, clamp, cuaPath, cubicBezier, defaultEffects, defaultSpec, dist, drawCursor, drawEffectsOver, drawEffectsUnder, driverSnippets, durationMs, easeFn, effects_d_exports as effects, fittsDuration, fittsTimingMs, hashString, inOutCubic, inOutSine, knobShape, lerp, lerpPt, linear, minJerk, motionParams, naturalSide, outCubic, paramsSnippet, perp, planDubins, planMove, planSpec, pointerForAnchor, pt, resolveEffects, resolvedEffects, smootherstep, specForStyle, specSnippet, straightPath, timingFloorMs, unit, wobbleProfile, wrapAngle };