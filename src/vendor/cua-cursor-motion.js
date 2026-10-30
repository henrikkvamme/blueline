//#region rolldown:runtime
var __defProp = Object.defineProperty;
var __export = (target, all) => {
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
};

//#endregion
//#region src/geom.ts
const pt = (x, y) => ({
	x,
	y
});
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPt = (a, b, t) => pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
function unit(a, b) {
	let d = dist(a, b);
	if (d === 0) d = 1;
	return pt((b.x - a.x) / d, (b.y - a.y) / d);
}
/** 90 degrees counter-clockwise in screen space (y down). */
const perp = (u) => pt(-u.y, u.x);
const TAU$1 = 2 * Math.PI;
/** Wrap an angle into `(-PI, PI]`. */
function wrapAngle(a) {
	let r = a % TAU$1;
	if (r > Math.PI) r -= TAU$1;
	if (r < -Math.PI) r += TAU$1;
	return r;
}
/**
* Distance from the cursor's hotspot (the tip) to its anchor (the body),
* along the heading, in points.
*/
const POINTER_ANCHOR_OFFSET = 16;
/** Anchor (body point) that places the hotspot on `(x, y)` at `heading`. */
function anchorForPointer(x, y, heading) {
	return [x + Math.cos(heading) * POINTER_ANCHOR_OFFSET, y + Math.sin(heading) * POINTER_ANCHOR_OFFSET];
}
/** Hotspot for an anchor at `heading`. */
function pointerForAnchor(x, y, heading) {
	return [x - Math.cos(heading) * POINTER_ANCHOR_OFFSET, y - Math.sin(heading) * POINTER_ANCHOR_OFFSET];
}

//#endregion
//#region src/rng.ts
/** FNV-1a over UTF-16 code units. */
function hashString(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
/** mulberry32, bit-identical to the Rust crate and the motion lab. */
var Rng = class {
	state;
	constructor(seed) {
		this.state = hashString(seed) || 1;
	}
	next() {
		let t = this.state = this.state + 1831565813 >>> 0;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	}
	range(lo, hi) {
		return lo + (hi - lo) * this.next();
	}
};

//#endregion
//#region src/ease.ts
const EASE_NAMES = [
	"linear",
	"min_jerk",
	"smootherstep",
	"in_out_cubic",
	"in_out_sine",
	"out_cubic"
];
const linear = (t) => t;
/** Minimum-jerk: the profile of a relaxed human reach. */
const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
const smootherstep = (t) => t * t * t * (t * (6 * t - 15) + 10);
const inOutCubic = (t) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const inOutSine = (t) => .5 - .5 * Math.cos(Math.PI * t);
const outCubic = (t) => 1 - (1 - t) ** 3;
/** CSS-style `cubic-bezier(x1, y1, x2, y2)`. */
function cubicBezier(x1, y1, x2, y2, t) {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	const cx1 = Math.min(Math.max(x1, 0), 1);
	const cx2 = Math.min(Math.max(x2, 0), 1);
	const coord = (a, b, u) => {
		const v = 1 - u;
		return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
	};
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 52; i++) {
		const mid = .5 * (lo + hi);
		if (coord(cx1, cx2, mid) < t) lo = mid;
		else hi = mid;
	}
	return coord(y1, y2, .5 * (lo + hi));
}
const NAMED = {
	linear,
	min_jerk: minJerk,
	smootherstep,
	in_out_cubic: inOutCubic,
	in_out_sine: inOutSine,
	out_cubic: outCubic
};
/** The function behind an `Ease` value. */
function easeFn(ease) {
	if (typeof ease === "string") return NAMED[ease];
	if (ease.type === "cubic_bezier") {
		const { x1, y1, x2, y2 } = ease;
		return (t) => cubicBezier(x1, y1, x2, y2, t);
	}
	return NAMED[ease.type];
}
/** Base plus a smooth bump that pushes `over` past the end, peaking at `overAt`. */
function bumpProfile(base, over, overAt) {
	const a = Math.max(overAt * 10, 1.5);
	const b = Math.max((1 - overAt) * 10, 1.5);
	const peak = (a / (a + b)) ** a * (b / (a + b)) ** b;
	return (tau) => base(tau) + over * (tau ** a * (1 - tau) ** b / peak);
}
/** Damped wobble around the end from `start` on. */
function wobbleProfile(base, amp, cycles, decay, start) {
	return (tau) => {
		if (tau <= start) return base(tau);
		const u = (tau - start) / (1 - start);
		const ramp = smootherstep(Math.min(u / .18, 1));
		return base(tau) + amp * ramp * Math.exp(-decay * u) * Math.sin(2 * Math.PI * cycles * u) * (1 - u) ** 2 / Math.max(Math.exp(-decay * .12) * .77, 1e-6);
	};
}

//#endregion
//#region src/path.ts
/** A parametric path with an arc-length table, so speed curves act on distance. */
var Path = class {
	length;
	us;
	ss;
	p0;
	p1;
	t0;
	t1;
	constructor(f, n) {
		this.f = f;
		this.us = new Float64Array(n + 1);
		this.ss = new Float64Array(n + 1);
		let prev = f(0);
		let total = 0;
		for (let i = 1; i <= n; i++) {
			const u = i / n;
			const p = f(u);
			total += Math.hypot(p.x - prev.x, p.y - prev.y);
			this.us[i] = u;
			this.ss[i] = total;
			prev = p;
		}
		this.length = total;
		this.p0 = f(0);
		this.p1 = f(1);
		this.t0 = unit(f(.001), this.p0);
		this.t1 = unit(f(.999), this.p1);
	}
	/** The point `frac` of the way along by distance; extrapolates past the ends. */
	atFraction(frac) {
		const len = this.length;
		if (len < 1e-9) return this.f(Math.min(Math.max(frac, 0), 1));
		if (frac > 1) return pt(this.p1.x + this.t1.x * (frac - 1) * len, this.p1.y + this.t1.y * (frac - 1) * len);
		if (frac < 0) return pt(this.p0.x + this.t0.x * -frac * len, this.p0.y + this.t0.y * -frac * len);
		const target = frac * len;
		let lo = 0;
		let hi = this.ss.length - 1;
		while (hi - lo > 1) {
			const mid = lo + hi >> 1;
			if (this.ss[mid] < target) lo = mid;
			else hi = mid;
		}
		let span = this.ss[hi] - this.ss[lo];
		if (span === 0) span = 1;
		return this.f(lerp(this.us[lo], this.us[hi], (target - this.ss[lo]) / span));
	}
};
const cubic = (p0, p1, p2, p3) => (u) => {
	const v = 1 - u;
	const a = v * v * v;
	const b = 3 * v * v * u;
	const c = 3 * v * u * u;
	const d = u * u * u;
	return pt(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y);
};
const quad = (p0, p1, p2) => (u) => {
	const v = 1 - u;
	return pt(v * v * p0.x + 2 * v * u * p1.x + u * u * p2.x, v * v * p0.y + 2 * v * u * p1.y + u * u * p2.y);
};
/** The Cua bezier as a path. */
function cuaPath(a, b, shape) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.max(Math.hypot(dx, dy), 1);
	const px = -dy / len;
	const py = dx / len;
	const deflection = len * shape.arcSize;
	const flow = (shape.arcFlow + 1) / 2;
	const c1d = deflection * (1 - .5 * flow);
	const c2d = deflection * (1 - .5 * (1 - flow));
	const c1 = pt(a.x + dx * shape.startHandle + px * c1d, a.y + dy * shape.startHandle + py * c1d);
	const c2 = pt(b.x - dx * shape.endHandle + px * c2d, b.y - dy * shape.endHandle + py * c2d);
	return new Path(cubic(a, c1, c2, b), 256);
}
/** Gentle single-sided quadratic curve. */
function bowPath(a, b, amount) {
	const d = dist(a, b);
	const n = perp(unit(a, b));
	const m = lerpPt(a, b, .5);
	return new Path(quad(a, pt(m.x + n.x * amount * d, m.y + n.y * amount * d), b), 256);
}
const straightPath = (a, b) => new Path((u) => lerpPt(a, b, u), 8);
/** Chord side that bends paths upward for horizontal moves. */
const naturalSide = (a, b) => unit(a, b).x >= 0 ? -1 : 1;

//#endregion
//#region src/dubins.ts
const TAU = 2 * Math.PI;
function mod2pi(x) {
	const r = x - TAU * Math.floor(x / TAU);
	return r < 0 ? r + TAU : r;
}
function lsl(d, a, b) {
	const tmp0 = d + Math.sin(a) - Math.sin(b);
	const p2 = 2 + d * d - 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) - Math.sin(b));
	if (p2 < 0) return null;
	const tmp1 = Math.atan2(Math.cos(b) - Math.cos(a), tmp0);
	return {
		t: mod2pi(-a + tmp1),
		p: Math.sqrt(p2),
		q: mod2pi(b - tmp1),
		types: [
			"L",
			"S",
			"L"
		]
	};
}
function rsr(d, a, b) {
	const tmp0 = d - Math.sin(a) + Math.sin(b);
	const p2 = 2 + d * d - 2 * Math.cos(a - b) + 2 * d * (Math.sin(b) - Math.sin(a));
	if (p2 < 0) return null;
	const tmp1 = Math.atan2(Math.cos(a) - Math.cos(b), tmp0);
	return {
		t: mod2pi(a - tmp1),
		p: Math.sqrt(p2),
		q: mod2pi(-b + tmp1),
		types: [
			"R",
			"S",
			"R"
		]
	};
}
function lsr(d, a, b) {
	const p2 = -2 + d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) + Math.sin(b));
	if (p2 < 0) return null;
	const p = Math.sqrt(p2);
	const tmp1 = Math.atan2(-(Math.cos(a) + Math.cos(b)), d + Math.sin(a) + Math.sin(b)) - Math.atan2(-2, p);
	return {
		t: mod2pi(-a + tmp1),
		p,
		q: mod2pi(-mod2pi(b) + tmp1),
		types: [
			"L",
			"S",
			"R"
		]
	};
}
function rsl(d, a, b) {
	const p2 = d * d - 2 + 2 * Math.cos(a - b) - 2 * d * (Math.sin(a) + Math.sin(b));
	if (p2 < 0) return null;
	const p = Math.sqrt(p2);
	const tmp1 = Math.atan2(Math.cos(a) + Math.cos(b), d - Math.sin(a) - Math.sin(b)) - Math.atan2(2, p);
	return {
		t: mod2pi(a - tmp1),
		p,
		q: mod2pi(b - tmp1),
		types: [
			"R",
			"S",
			"L"
		]
	};
}
function rlr(d, a, b) {
	const tmp = (6 - d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) - Math.sin(b))) / 8;
	if (Math.abs(tmp) > 1) return null;
	const p = mod2pi(TAU - Math.acos(tmp));
	const t = mod2pi(a - Math.atan2(Math.cos(a) - Math.cos(b), d - Math.sin(a) + Math.sin(b)) + p / 2);
	return {
		t,
		p,
		q: mod2pi(a - b - t + p),
		types: [
			"R",
			"L",
			"R"
		]
	};
}
function lrl(d, a, b) {
	const tmp = (6 - d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(b) - Math.sin(a))) / 8;
	if (Math.abs(tmp) > 1) return null;
	const p = mod2pi(TAU - Math.acos(tmp));
	const t = mod2pi(-a + Math.atan2(-Math.cos(a) + Math.cos(b), d + Math.sin(a) - Math.sin(b)) + p / 2);
	return {
		t,
		p,
		q: mod2pi(mod2pi(b) - a - t + p),
		types: [
			"L",
			"R",
			"L"
		]
	};
}
/** Plan a Dubins path from `(x0, y0)` heading `th0` to `(x1, y1)` heading `th1`. */
function planDubins(x0, y0, th0, x1, y1, th1, turnRadius) {
	const r = Math.max(turnRadius, 1);
	const dx = x1 - x0;
	const dy = y1 - y0;
	const dd = Math.hypot(dx, dy);
	let best = null;
	if (dd >= .5) {
		const d = dd / r;
		const theta = mod2pi(Math.atan2(dy, dx));
		const a = mod2pi(th0 - theta);
		const b = mod2pi(th1 - theta);
		let bestLen = Infinity;
		for (const solver of [
			lsl,
			rsr,
			lsr,
			rsl,
			rlr,
			lrl
		]) {
			const sol$1 = solver(d, a, b);
			if (!sol$1) continue;
			const len = sol$1.t + sol$1.p + sol$1.q;
			if (Number.isFinite(len) && len >= 0 && len < bestLen) {
				bestLen = len;
				best = sol$1;
			}
		}
	}
	if (!best) {
		const length = Math.max(dd, 1);
		return {
			length,
			sample(s) {
				const u = Math.min(Math.max(s / Math.max(length, 1), 0), 1);
				let diff = th1 - th0;
				while (diff > Math.PI) diff -= TAU;
				while (diff < -Math.PI) diff += TAU;
				return {
					x: x0 + (x1 - x0) * u,
					y: y0 + (y1 - y0) * u,
					heading: th0 + diff * u
				};
			}
		};
	}
	const sol = best;
	const l1 = sol.t * r;
	const l2 = sol.p * r;
	const l3 = sol.q * r;
	return {
		length: (sol.t + sol.p + sol.q) * r,
		sample(sIn) {
			if (sIn <= 0) return {
				x: x0,
				y: y0,
				heading: th0
			};
			const s = Math.min(sIn, l1 + l2 + l3);
			let x = x0;
			let y = y0;
			let th = th0;
			const advance = (len, seg) => {
				if (seg === "S") {
					x += Math.cos(th) * len;
					y += Math.sin(th) * len;
				} else {
					const dth = len / r * (seg === "L" ? 1 : -1);
					const side$1 = seg === "L" ? Math.PI / 2 : -Math.PI / 2;
					const cx = x + Math.cos(th + side$1) * r;
					const cy = y + Math.sin(th + side$1) * r;
					const ang = Math.atan2(y - cy, x - cx);
					x = cx + Math.cos(ang + dth) * r;
					y = cy + Math.sin(ang + dth) * r;
					th += dth;
				}
			};
			if (s <= l1) {
				advance(s, sol.types[0]);
				return {
					x,
					y,
					heading: th
				};
			}
			advance(l1, sol.types[0]);
			if (s <= l1 + l2) {
				advance(s - l1, sol.types[1]);
				return {
					x,
					y,
					heading: th
				};
			}
			advance(l2, sol.types[1]);
			advance(s - l1 - l2, sol.types[2]);
			return {
				x,
				y,
				heading: th
			};
		}
	};
}

//#endregion
//#region src/style.ts
const MOTION_STYLES = [
	"signature_arc",
	"spring_settle",
	"magnetic",
	"comet_swoop",
	"adaptive",
	"classic"
];
const MOTION_TIMINGS = [
	"native",
	"fitts",
	"fixed",
	"relaxed",
	"steady",
	"calm",
	"deliberate"
];
/** Minimum move time of the floor timings, or `null`. */
function timingFloorMs(timing) {
	switch (timing) {
		case "relaxed": return 450;
		case "steady": return 600;
		case "calm": return 750;
		default: return null;
	}
}
const EFFECT_NAMES = [
	"trail",
	"glow",
	"magnet",
	"ripple",
	"squish"
];
const NO_EFFECTS = {
	trail: false,
	glow: false,
	magnet: false,
	ripple: false,
	squish: false
};
/** Effects a style turns on when the caller leaves them unset. */
function defaultEffects(style) {
	const on = (...names) => {
		const out = { ...NO_EFFECTS };
		for (const n of names) out[n] = true;
		return out;
	};
	switch (style) {
		case "signature_arc": return on();
		case "spring_settle": return on("glow", "squish");
		case "magnetic": return on("magnet", "ripple");
		case "comet_swoop": return on("trail", "ripple");
		case "adaptive": return on("squish");
		case "classic": return on();
	}
}
function resolveEffects(overrides, base) {
	const out = { ...base };
	for (const n of EFFECT_NAMES) {
		const v = overrides?.[n];
		if (v !== void 0 && v !== null) out[n] = v;
	}
	return out;
}
/** Fixed-timing duration when `glideDurationMs` is 0. */
const DEFAULT_FIXED_MS = 1430;

//#endregion
//#region src/params.ts
const DEFAULT_PARAMS = Object.freeze({
	style: "signature_arc",
	timing: "steady",
	effects: {},
	startHandle: .3,
	endHandle: .3,
	arcSize: .25,
	arcFlow: 0,
	spring: .72,
	glideDurationMs: 0,
	peakSpeed: 900,
	minStartSpeed: 300,
	minEndSpeed: 200,
	turnRadius: 80
});
const motionParams = (p = {}) => ({
	...DEFAULT_PARAMS,
	...p,
	effects: { ...p.effects ?? {} }
});
const resolvedEffects = (p) => resolveEffects(p.effects, defaultEffects(p.style));

//#endregion
//#region src/effects.ts
var effects_exports = {};
__export(effects_exports, {
	CLICK_FX_SECS: () => CLICK_FX_SECS,
	DEFAULT_TRAIL: () => DEFAULT_TRAIL,
	MAGNET_INFLATE: () => MAGNET_INFLATE,
	MAGNET_SECS: () => MAGNET_SECS,
	RIPPLE_SECS: () => RIPPLE_SECS,
	SQUISH: () => SQUISH,
	addClick: () => addClick,
	effectRgb: () => effectRgb,
	emptyFrame: () => emptyFrame,
	glow: () => glow,
	linger: () => linger,
	magnet: () => magnet,
	motionFrame: () => motionFrame,
	ripple: () => ripple,
	squish: () => squish,
	trail: () => trail
});
const DEFAULT_TRAIL = Object.freeze({
	secs: .18,
	fadeLen: 60,
	steps: 26,
	tailWidth: 2,
	headWidth: 12,
	alpha: .38,
	anchorOffset: POINTER_ANCHOR_OFFSET
});
const MAGNET_SECS = .7;
const MAGNET_INFLATE = 6;
const RIPPLE_SECS = .52;
const CLICK_FX_SECS = .55;
const SQUISH = .12;
const emptyFrame = () => ({
	glow: null,
	trail: [],
	magnet: null,
	ripple: null,
	squish: 0
});
/** Speed glow at `t` around `pos` (the cursor's anchor). */
function glow(traj, t, pos) {
	if (t >= traj.duration()) return null;
	const [vx, vy] = traj.velocityAt(t);
	const speed = Math.hypot(vx, vy);
	const alpha = Math.min(speed * 14e-5, .42);
	if (alpha <= .02) return null;
	const off = Math.min(speed * .009, 18);
	return {
		x: pos[0] - vx / speed * off,
		y: pos[1] - vy / speed * off,
		r: 30 * (1 + Math.min(speed * 24e-5, .44)),
		alpha
	};
}
/** Comet trail at `t`, tail first, following the arrow's body. */
function trail(traj, t) {
	const spec = traj.trail;
	const steps = Math.max(spec.steps, 1);
	const pts = [];
	for (let i = 0; i <= steps; i++) {
		const s = traj.sampleAt(t - spec.secs + spec.secs * (i / steps));
		pts.push([s.x + Math.cos(s.heading) * spec.anchorOffset, s.y + Math.sin(s.heading) * spec.anchorOffset]);
	}
	let length = 0;
	for (let i = 1; i <= steps; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
	const fade = Math.min(length / spec.fadeLen, 1);
	const out = [];
	for (let i = 1; i <= steps; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const k = i / steps;
		if (Math.hypot(b[0] - a[0], b[1] - a[1]) > .3) out.push({
			a,
			b,
			width: spec.tailWidth + (spec.headWidth - spec.tailWidth) * k,
			alpha: spec.alpha * k * k * fade
		});
	}
	return out;
}
/** Magnet glow at `t`, after a lock-on. */
function magnet(traj, t) {
	if (traj.snapT === null) return null;
	const age = t - traj.snapT;
	if (!(age >= 0 && age < MAGNET_SECS)) return null;
	const end = traj.end();
	return {
		rect: traj.targetKnown ? traj.target : [
			end.x - 12,
			end.y - 12,
			24,
			24
		],
		glow: 1 - age / MAGNET_SECS
	};
}
/** Click ripple `age` seconds after a click at `point`. */
function ripple(age, point) {
	if (age >= RIPPLE_SECS) return null;
	const k = age / RIPPLE_SECS;
	const easeOut = 1 - (1 - k) ** 3;
	return {
		x: point[0],
		y: point[1],
		r: 8 + 44 * easeOut,
		width: 4 * (1 - k) + 1,
		alpha: .75 * (1 - k)
	};
}
/** Click squish `age` seconds after a click. */
function squish(age) {
	const PRESS = .09;
	if (age < PRESS) return SQUISH * Math.min(age / .05, 1);
	const after = age - PRESS;
	return SQUISH * Math.max(Math.cos(Math.min(after / .22, 1) * Math.PI * 1.5), 0) * Math.max(1 - after / .22, 0);
}
/** The move's effects at `t`. `pos` is the anchor; `blend` = can draw translucency. */
function motionFrame(traj, t, pos, blend = true) {
	const fx = traj.effects;
	return {
		glow: fx.glow && blend ? glow(traj, t, pos) : null,
		trail: fx.trail && blend ? trail(traj, t) : [],
		magnet: fx.magnet ? magnet(traj, t) : null,
		ripple: null,
		squish: 0
	};
}
/** Add the click effects `age` seconds after a click at `point`. */
function addClick(frame, effects, age, point) {
	if (effects.ripple) frame.ripple = ripple(age, point);
	if (effects.squish) frame.squish = squish(age);
}
/** When a finished trajectory can be dropped (trail caught up, magnet faded). */
function linger(traj) {
	let end = traj.duration();
	if (traj.effects.trail) end += traj.trail.secs;
	if (traj.effects.magnet && traj.snapT !== null) end = Math.max(end, traj.snapT + MAGNET_SECS);
	return end;
}
/** Effect colour: the cursor fill lifted toward white. */
function effectRgb(fill) {
	const lift = (c) => Math.round(c + (255 - c) * .45);
	return [
		lift(fill[0]),
		lift(fill[1]),
		lift(fill[2])
	];
}

//#endregion
//#region src/spec.ts
/** The Fitts model the director's-cut styles share. */
const fittsDuration = (scale) => ({
	type: "fitts",
	a: 150,
	b: 120,
	minMs: 300,
	maxMs: 1e3,
	scale
});
function durationMs(d, distance, width) {
	const clamp$1 = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
	switch (d.type) {
		case "fixed": return d.ms;
		case "fitts": return clamp$1(d.a + d.b * Math.log2(distance / Math.max(width, 4) + 1), d.minMs, d.maxMs) * d.scale;
		case "distance": return clamp$1(d.baseMs + d.msPerPt * distance, d.minMs, d.maxMs);
	}
}
/** Scale a style's own arc by the `arcSize` knob and shift its flow by `arcFlow`. */
function knobShape(params, arcSize, arcFlow) {
	return {
		startHandle: params.startHandle,
		endHandle: params.endHandle,
		arcSize: arcSize * (params.arcSize / DEFAULT_PARAMS.arcSize),
		arcFlow: Math.min(Math.max(arcFlow + params.arcFlow, -1), 1)
	};
}
/**
* The spec behind a built-in style. `magnetic`, `adaptive` and `classic` are
* simulations rather than specs and return `null`.
*/
function specForStyle(style, params = {}) {
	const p = motionParams({
		...params,
		style
	});
	const base = (path, ease, settle, duration) => ({
		path,
		ease,
		settle,
		duration,
		heading: "tangent",
		effects: resolvedEffects(p),
		trail: { ...DEFAULT_TRAIL }
	});
	switch (style) {
		case "signature_arc": return base({
			type: "arc",
			...knobShape(p, .16, .15)
		}, "min_jerk", {
			type: "follow_through",
			amount: .018,
			maxPt: 8,
			at: .82
		}, fittsDuration(1.1));
		case "spring_settle": return base({
			type: "arc",
			...knobShape(p, .12, 0)
		}, "min_jerk", {
			type: "spring",
			amount: .05,
			maxPt: 6,
			cycles: 1.3,
			decay: 2.6,
			start: .55,
			glideEnd: .68
		}, fittsDuration(1.35));
		case "comet_swoop": return base({
			type: "arc",
			...knobShape(p, .24, .2)
		}, "in_out_cubic", { type: "none" }, fittsDuration(1.15));
		default: return null;
	}
}
/** `signature_arc` as a spec: a good starting point for your own. */
const defaultSpec = () => specForStyle("signature_arc");

//#endregion
//#region src/plan.ts
/** Sample period of every planned trajectory, ms (120 Hz). */
const DT_MS = 1e3 / 120;
/** Target box assumed when a move has no element rect. */
const DEFAULT_TARGET_PT = 24;
/** The arrow's rest heading: pointing up and to the left. */
const REST_HEADING = Math.PI / 4;
const ARRIVAL_TOLERANCE_PT = 1;
const REDUCED_MOTION_MS = 120;
function sampleTimed(pos, ms) {
	const c = Math.ceil(ms / DT_MS);
	const n = Math.max(Number.isFinite(c) && c > 0 ? c : 0, 2);
	const out = [];
	for (let i = 0; i <= n; i++) {
		const tau = i / n;
		const p = pos(tau);
		out.push({
			t: tau * ms,
			x: p.x,
			y: p.y
		});
	}
	return out;
}
function pinEnds(samples, from, aim) {
	if (samples.length) {
		samples[0].x = from.x;
		samples[0].y = from.y;
		samples[samples.length - 1].x = aim.x;
		samples[samples.length - 1].y = aim.y;
	}
	return samples;
}
const glide = (from, aim, path, profile, ms) => pinEnds(sampleTimed((tau) => path.atFraction(profile(tau)), ms), from, aim);
function speedShaped(from, aim, path, shape, ms) {
	const N = 600;
	const ts = new Float64Array(N + 1);
	for (let i = 1; i <= N; i++) ts[i] = ts[i - 1] + 1 / Math.max(shape((i - .5) / N), .001);
	const total = ts[N];
	return pinEnds(sampleTimed((tau) => {
		const target = tau * total;
		let lo = 0;
		let hi = N;
		while (hi - lo > 1) {
			const mid = lo + hi >> 1;
			if (ts[mid] < target) lo = mid;
			else hi = mid;
		}
		const f = (target - ts[lo]) / Math.max(ts[hi] - ts[lo], 1e-9);
		return path.atFraction((lo + f) / N);
	}, ms), from, aim);
}
const ctxD = (c) => dist(c.from, c.aim);
const targetWidth = (c) => Math.max(Math.min(c.target[2], c.target[3]), 4);
const side = (c) => naturalSide(c.from, c.aim);
/** Global Fitts timing: `150 + 120 log2(D / W + 1)` ms, 300..1000. */
function fittsTimingMs(d, w) {
	return Math.min(Math.max(150 + 120 * Math.log2(d / Math.max(w, 4) + 1), 300), 1e3);
}
/** `deliberate` timing: `400 + 120 log2(D / W + 1)` ms, 450..1300. */
function deliberateTimingMs(d, w) {
	return Math.min(Math.max(400 + 120 * Math.log2(d / Math.max(w, 4) + 1), 450), 1300);
}
function generateSpec(spec, c) {
	const s = side(c);
	const sp = spec.path;
	const path = sp.type === "straight" ? straightPath(c.from, c.aim) : sp.type === "arc" ? cuaPath(c.from, c.aim, {
		...sp,
		arcSize: sp.arcSize * s
	}) : bowPath(c.from, c.aim, sp.amount * s);
	const ease = easeFn(spec.ease);
	const ms = durationMs(spec.duration, ctxD(c), targetWidth(c));
	const st = spec.settle;
	switch (st.type) {
		case "none": return glide(c.from, c.aim, path, ease, ms);
		case "follow_through": {
			const over = Math.min(st.amount, st.maxPt / Math.max(ctxD(c), 1));
			return glide(c.from, c.aim, path, bumpProfile(ease, over, st.at), ms);
		}
		case "spring": {
			const amp = Math.min(st.amount, st.maxPt / Math.max(ctxD(c), 1));
			const glideEnd = st.glideEnd;
			const profile = wobbleProfile((t) => ease(Math.min(t / glideEnd, 1)), amp, st.cycles, st.decay, st.start);
			return glide(c.from, c.aim, path, profile, ms);
		}
	}
}
function magnetic(c) {
	const path = bowPath(c.from, c.aim, .04 * side(c));
	const len = path.length;
	const radius = Math.min(40, len * .5);
	const pull = .45;
	const enterSpeed = 300;
	const out = [{
		t: 0,
		x: c.from.x,
		y: c.from.y
	}];
	let s = 0;
	let v = 0;
	let t = 0;
	let snap = null;
	const dt = DT_MS / 1e3;
	while (s < len && t < 4) {
		const rem = len - s;
		if (rem > radius) v = Math.min(1500, v + 7e3 * dt, enterSpeed + 5.5 * (rem - radius));
		else {
			if (snap === null) snap = t * 1e3;
			v += 26e3 * pull * (radius / Math.max(rem, 6)) * dt;
		}
		s = Math.min(len, s + v * dt);
		t += dt;
		const q = path.atFraction(s / len);
		out.push({
			t: t * 1e3,
			x: q.x,
			y: q.y
		});
	}
	return [pinEnds(out, c.from, c.aim), snap ?? t * 1e3];
}
const plain = (path, ease, duration) => ({
	path,
	ease,
	settle: { type: "none" },
	duration,
	heading: "tangent",
	effects: { ...NO_EFFECTS },
	trail: { ...DEFAULT_TRAIL }
});
const FITTS_MS = {
	type: "fitts",
	a: 50,
	b: 150,
	minMs: 180,
	maxMs: 1400,
	scale: 1
};
const fittsMinjerk = (c) => generateSpec(plain({
	type: "bow",
	amount: .02
}, "min_jerk", FITTS_MS), c);
function keynoteSwoop(c, rng) {
	const arc = rng.range(.25, .35);
	return generateSpec(plain({
		type: "arc",
		startHandle: .3,
		endHandle: .3,
		arcSize: arc,
		arcFlow: .2
	}, "in_out_cubic", {
		type: "distance",
		baseMs: 350,
		msPerPt: .35,
		minMs: 450,
		maxMs: 1100
	}), c);
}
function preciseClick(c) {
	const fp = .15;
	const fs = .35;
	const shape = (s) => s < .4 ? .04 + Math.sin(Math.PI * s / .8) : s < 1 - fp ? 1 - (1 - fs) * inOutSine((s - .4) / (.6 - fp)) : .02 + fs * Math.sqrt(Math.max((1 - s) / fp, 0));
	const path = bowPath(c.from, c.aim, .03 * side(c));
	return speedShaped(c.from, c.aim, path, shape, durationMs(FITTS_MS, ctxD(c), targetWidth(c)) * 1.2);
}
/** Which generator `adaptive` picks for a move. */
function adaptivePick(c) {
	if (targetWidth(c) < 16) return "precise_click";
	if (ctxD(c) > 900) return "keynote_swoop";
	return "fitts_minjerk";
}
function retime(samples, targetMs) {
	const total = samples.length ? samples[samples.length - 1].t : 0;
	if (Number.isNaN(total) || total <= 0 || samples.length < 3) return;
	const k = targetMs / total;
	for (const s of samples) s.t *= k;
}
function applyTiming(samples, events, c, timing, fixedMs) {
	const total = samples.length ? samples[samples.length - 1].t : 0;
	let want;
	const last = samples.length ? samples[samples.length - 1] : c.aim;
	const d = dist(c.from, pt(last.x, last.y));
	const w = Math.min(c.target[2], c.target[3]);
	const floor = timingFloorMs(timing);
	if (timing === "native") return;
	if (timing === "fixed") want = fixedMs;
	else if (timing === "fitts") want = fittsTimingMs(d, w);
	else if (timing === "deliberate") want = deliberateTimingMs(d, w);
	else {
		if (floor === null || total >= floor) return;
		want = floor;
	}
	if (total > 0) {
		retime(samples, want);
		for (let i = 0; i < events.length; i++) events[i] = events[i] * want / total;
	}
}
/** A planned move, played back by time. */
var Trajectory = class {
	constructor(samples, arrivalT, snapT, target, targetKnown, effects, trail$1, style) {
		this.samples = samples;
		this.arrivalT = arrivalT;
		this.snapT = snapT;
		this.target = target;
		this.targetKnown = targetKnown;
		this.effects = effects;
		this.trail = trail$1;
		this.style = style;
	}
	duration() {
		return this.samples.length ? this.samples[this.samples.length - 1].t : 0;
	}
	end() {
		return this.samples[this.samples.length - 1];
	}
	/** Interpolated sample at `t` seconds, clamped to the ends. */
	sampleAt(t) {
		const first = this.samples[0];
		if (t <= first.t) return first;
		const last = this.end();
		if (t >= last.t) return last;
		let lo = 0;
		let hi = this.samples.length;
		while (lo < hi) {
			const mid = lo + hi >> 1;
			if (this.samples[mid].t <= t) lo = mid + 1;
			else hi = mid;
		}
		const a = this.samples[lo - 1];
		const b = this.samples[lo];
		const f = (t - a.t) / (b.t - a.t);
		return {
			t,
			x: lerp(a.x, b.x, f),
			y: lerp(a.y, b.y, f),
			heading: a.heading + wrapAngle(b.heading - a.heading) * f
		};
	}
	/** Hotspot velocity at `t`, pt/s. */
	velocityAt(t) {
		const h = .008;
		if (t > this.duration() + h) return [0, 0];
		const a = this.sampleAt(t - h);
		const b = this.sampleAt(t + h);
		return [(b.x - a.x) / (2 * h), (b.y - a.y) / (2 * h)];
	}
};
const TIP_ANGLE = -.75 * Math.PI;
function resolve(req) {
	const r = req.target;
	const known = !!r && r.every((v) => Number.isFinite(v)) && r[2] > 0 && r[3] > 0;
	const h = DEFAULT_TARGET_PT / 2;
	return {
		from: req.from,
		to: req.to,
		fromHeading: req.fromHeading ?? REST_HEADING,
		endHeading: req.endHeading ?? REST_HEADING,
		target: known ? r : [
			req.to.x - h,
			req.to.y - h,
			DEFAULT_TARGET_PT,
			DEFAULT_TARGET_PT
		],
		targetKnown: known,
		seed: req.seed ?? ""
	};
}
function finish(rawIn, snapMs, q, effects, trail$1, style, mode) {
	const raw = rawIn.length ? rawIn : [{
		t: 0,
		x: q.to.x,
		y: q.to.y
	}];
	const n = raw.length;
	let rot = wrapAngle(q.fromHeading - q.endHeading);
	const samples = [];
	for (let i = 0; i < n; i++) {
		const a = raw[Math.max(i - 2, 0)];
		const b = raw[Math.min(i + 2, n - 1)];
		const dt$1 = Math.max((b.t - a.t) / 1e3, .001);
		const vx = (b.x - a.x) / dt$1;
		const vy = (b.y - a.y) / dt$1;
		const speed = Math.hypot(vx, vy);
		let want = 0;
		if (mode === "tangent") {
			const w = Math.min(Math.max((speed - 40) / 260, 0), 1);
			want = wrapAngle(Math.atan2(vy, vx) - TIP_ANGLE) * w;
		}
		const step = i > 0 ? (raw[i].t - raw[i - 1].t) / 1e3 : 0;
		const k = 1 - Math.exp(-step * 22);
		rot += wrapAngle(want - rot) * k;
		samples.push({
			t: raw[i].t / 1e3,
			x: raw[i].x,
			y: raw[i].y,
			heading: q.endHeading + rot
		});
	}
	const end = samples[samples.length - 1];
	let t = end.t;
	const dt = DT_MS / 1e3;
	for (let i = 0; i < 36; i++) {
		if (Math.abs(rot) < .002) break;
		t += dt;
		rot -= rot * (1 - Math.exp(-dt * 22));
		samples.push({
			...end,
			t,
			heading: q.endHeading + rot
		});
	}
	samples[samples.length - 1] = {
		...samples[samples.length - 1],
		heading: q.endHeading
	};
	const hit = samples.find((s) => Math.hypot(s.x - q.to.x, s.y - q.to.y) <= ARRIVAL_TOLERANCE_PT);
	const arrival = hit ? hit.t : samples[samples.length - 1].t;
	return new Trajectory(samples, arrival, snapMs === null ? null : snapMs / 1e3, q.target, q.targetKnown, effects, trail$1, style);
}
function reduced(q, style) {
	const raw = glide(q.from, q.to, straightPath(q.from, q.to), minJerk, REDUCED_MOTION_MS);
	return finish(raw, null, q, { ...NO_EFFECTS }, { ...DEFAULT_TRAIL }, style, "fixed");
}
/** Plan one move for a built-in style. Unset params take Cua Driver's defaults. */
function planMove(params, req) {
	const p = motionParams(params);
	const q = resolve(req);
	const c = {
		from: q.from,
		aim: q.to,
		target: q.target
	};
	const fixedMs = p.glideDurationMs > 0 ? p.glideDurationMs : DEFAULT_FIXED_MS;
	const legacy = p.timing === "native" || p.timing === DEFAULT_PARAMS.timing;
	const timing = legacy && p.glideDurationMs > 0 ? "fixed" : p.timing;
	if (req.reducedMotion) return reduced(q, p.style);
	if (p.style === "classic") return planClassic(p, q, timing, fixedMs);
	let spec = specForStyle(p.style, p);
	const floor = timingFloorMs(timing);
	if (spec && floor !== null) {
		const ms = durationMs(spec.duration, ctxD(c), targetWidth(c));
		spec = {
			...spec,
			duration: {
				type: "fixed",
				ms: Math.max(ms, floor)
			},
			ease: "in_out_sine"
		};
	}
	let raw;
	let snap = null;
	if (spec) raw = generateSpec(spec, c);
	else if (p.style === "magnetic") [raw, snap] = magnetic(c);
	else {
		const rng = new Rng(q.seed);
		const pick = adaptivePick(c);
		raw = pick === "precise_click" ? preciseClick(c) : pick === "keynote_swoop" ? keynoteSwoop(c, rng) : fittsMinjerk(c);
	}
	const events = snap === null ? [] : [snap];
	applyTiming(raw, events, c, timing, fixedMs);
	return finish(raw, events.length ? events[0] : null, q, resolvedEffects(p), { ...DEFAULT_TRAIL }, p.style, p.style === "magnetic" ? "fixed" : "tangent");
}
/** Plan one move for a custom spec. */
function planSpec(spec, req) {
	const q = resolve(req);
	if (req.reducedMotion) return reduced(q, null);
	const raw = generateSpec(spec, {
		from: q.from,
		aim: q.to,
		target: q.target
	});
	return finish(raw, null, q, { ...spec.effects }, { ...spec.trail }, null, spec.heading);
}
function planClassic(p, q, timing, fixedMs) {
	const K = 400;
	const OVERSHOOT = .8;
	const springC = 17 * p.spring / .72;
	const dt = DT_MS / 1e3;
	const [ax, ay] = anchorForPointer(q.from.x, q.from.y, q.fromHeading);
	const [tx, ty] = anchorForPointer(q.to.x, q.to.y, q.endHeading);
	const path = planDubins(ax, ay, q.fromHeading + Math.PI, tx, ty, q.endHeading + Math.PI, p.turnRadius);
	const pathLen = Math.max(path.length, 1);
	const fixed = timing === "fixed";
	const out = [];
	const push = (t$1, x, y, heading) => {
		const [px, py] = pointerForAnchor(x, y, heading);
		out.push({
			t: t$1,
			x: px,
			y: py,
			heading
		});
	};
	push(0, ax, ay, q.fromHeading);
	let d = 0;
	let t = 0;
	let speed = 0;
	let guard = 0;
	while (d < pathLen && guard < 2e4) {
		guard++;
		const u = Math.min(d / pathLen, 1);
		const profile = 30 * u * u * (1 - u) * (1 - u) / 1.875;
		const floor = u < .5 ? p.minStartSpeed : p.minEndSpeed;
		speed = fixed ? pathLen / (fixedMs / 1e3) : floor + (p.peakSpeed - floor) * profile;
		d += speed * dt;
		t += dt;
		if (d >= pathLen) break;
		const s = path.sample(d);
		push(t, s.x, s.y, s.heading + Math.PI);
	}
	const end = path.sample(pathLen);
	push(t, tx, ty, q.endHeading);
	let arrival = t;
	const impulse = fixed ? p.minEndSpeed : speed;
	let ox = 0;
	let oy = 0;
	let vx = impulse * OVERSHOOT * Math.cos(end.heading);
	let vy = impulse * OVERSHOOT * Math.sin(end.heading);
	for (let i = 0; i < 600; i++) {
		const sdt = dt / 4;
		for (let j = 0; j < 4; j++) {
			vx += (-K * ox - springC * vx) * sdt;
			vy += (-K * oy - springC * vy) * sdt;
			ox += vx * sdt;
			oy += vy * sdt;
		}
		t += dt;
		if (Math.hypot(ox, oy) < .3 && Math.hypot(vx, vy) < 2) break;
		push(t, tx + ox, ty + oy, q.endHeading);
	}
	push(t + dt, tx, ty, q.endHeading);
	if (timing === "fitts") {
		const total = out[out.length - 1].t;
		if (total > 0) {
			const want = fittsTimingMs(dist(q.from, q.to), Math.min(q.target[2], q.target[3])) / 1e3;
			const k = want / total;
			for (const s of out) s.t *= k;
			arrival *= k;
		}
	}
	return new Trajectory(out, arrival, null, q.target, q.targetKnown, resolvedEffects(p), { ...DEFAULT_TRAIL }, "classic");
}

//#endregion
//#region src/render.ts
/**
* The Cua Driver cursor body (`cursor-overlay/assets/build_default_theme.py`
* `CURSOR_PATH`) on its 128-unit canvas, hotspot at (55, 30).
*/
const CURSOR_PATH = "M55 30 C48 28 42 33 43 41 C43 41 64 98 64 98 C67 106 73 106 77 99 C77 99 86 79 86 79 C88 75 91 72 95 70 C95 70 108 63 108 63 C115 59 114 53 107 50 C107 50 55 30 55 30 Z";
const CURSOR_HOTSPOT = {
	x: 55,
	y: 30
};
const CANVAS_SIZE = 128;
/** On-screen size of the 128-unit cursor canvas, pt (Cua Driver's `DISPLAY_SIZE`). */
const CURSOR_DISPLAY_SIZE = 42;
/** Cua blue, the default cursor fill. */
const CUA_BLUE = "#5ec0e8";
/** The glow strokes under the body: width (canvas units) and opacity. */
const GLOW_LAYERS = [
	[44, .02],
	[36, .024],
	[29, .03],
	[23, .038],
	[18, .048],
	[14, .06],
	[10, .075],
	[7, .095]
];
const FLOAT_SECS = 4;
let cursorPath = null;
function hexRgb(hex) {
	const h = hex.replace("#", "");
	const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
	return [
		n >> 16 & 255,
		n >> 8 & 255,
		n & 255
	];
}
/** Draw the Cua cursor with its tip on `(x, y)`, rotated to `heading` (rest = pi/4). */
function drawCursor(g, x, y, heading, style = {}) {
	const fill = style.fill ?? CUA_BLUE;
	const s = CURSOR_DISPLAY_SIZE / CANVAS_SIZE * (style.scale ?? 1) * (1 - (style.squish ?? 0));
	let fx = 0;
	let fy = 0;
	let fr = 0;
	if (style.floatT != null) {
		const a = style.floatT % FLOAT_SECS / FLOAT_SECS * 2 * Math.PI;
		fx = Math.sin(a) * 5;
		fy = 6 * Math.cos(a) - 5;
		fr = 2.5 * Math.PI / 180 * Math.cos(a);
	}
	cursorPath ??= new Path2D(CURSOR_PATH);
	g.save();
	g.globalAlpha = style.alpha ?? 1;
	g.translate(x + fx * s, y + fy * s);
	g.rotate(heading - Math.PI / 4 + fr);
	g.scale(s, s);
	g.translate(-CURSOR_HOTSPOT.x, -CURSOR_HOTSPOT.y);
	g.lineCap = "round";
	g.lineJoin = "round";
	for (const [width, opacity] of GLOW_LAYERS) {
		g.globalAlpha = (style.alpha ?? 1) * opacity;
		g.strokeStyle = fill;
		g.lineWidth = width;
		g.stroke(cursorPath);
	}
	g.globalAlpha = style.alpha ?? 1;
	g.fillStyle = fill;
	g.fill(cursorPath);
	g.strokeStyle = "#ffffff";
	g.lineWidth = 5;
	g.stroke(cursorPath);
	g.restore();
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.min(Math.max(a, 0), 1)})`;
/** Paint the effects that sit under the cursor: glow, trail, magnet. */
function drawEffectsUnder(g, f, fill = CUA_BLUE) {
	const c = effectRgb(hexRgb(fill));
	if (f.glow) {
		const grad = g.createRadialGradient(f.glow.x, f.glow.y, 0, f.glow.x, f.glow.y, f.glow.r);
		grad.addColorStop(0, rgba(c, f.glow.alpha));
		grad.addColorStop(1, rgba(c, 0));
		g.fillStyle = grad;
		g.beginPath();
		g.arc(f.glow.x, f.glow.y, f.glow.r, 0, 2 * Math.PI);
		g.fill();
	}
	g.lineCap = "round";
	for (const seg of f.trail) {
		g.strokeStyle = rgba(c, seg.alpha);
		g.lineWidth = seg.width;
		g.beginPath();
		g.moveTo(seg.a[0], seg.a[1]);
		g.lineTo(seg.b[0], seg.b[1]);
		g.stroke();
	}
	if (f.magnet) {
		const [x, y, w, h] = f.magnet.rect;
		const i = MAGNET_INFLATE;
		for (const [width, a] of [
			[14, .1],
			[8, .22],
			[3, .9]
		]) {
			g.strokeStyle = rgba(c, a * f.magnet.glow);
			g.lineWidth = width;
			g.beginPath();
			g.roundRect(x - i, y - i, w + 2 * i, h + 2 * i, Math.min(8, (w + 2 * i) / 2, (h + 2 * i) / 2));
			g.stroke();
		}
	}
}
/** Paint the click ripple, which sits over the cursor. */
function drawEffectsOver(g, f, fill = CUA_BLUE) {
	if (!f.ripple) return;
	g.strokeStyle = rgba(effectRgb(hexRgb(fill)), f.ripple.alpha);
	g.lineWidth = f.ripple.width;
	g.beginPath();
	g.arc(f.ripple.x, f.ripple.y, f.ripple.r, 0, 2 * Math.PI);
	g.stroke();
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
var MotionPlayer = class {
	/** Hotspot. */
	pos = {
		x: 0,
		y: 0
	};
	heading = REST_HEADING;
	trajectory = null;
	/** Playback speed; 0.25 plays at quarter speed. */
	timeScale = 1;
	motionT = 0;
	arrival = null;
	clickAge = null;
	clickPoint = [0, 0];
	clickEffects = { ...NO_EFFECTS };
	pendingClick = false;
	idleT = 0;
	last = 0;
	raf = 0;
	moves = 0;
	g;
	constructor(canvas, options = {}) {
		this.canvas = canvas;
		this.options = options;
		const g = canvas.getContext("2d");
		if (!g) throw new Error("canvas 2d context unavailable");
		this.g = g;
		this.raf = requestAnimationFrame(this.frame);
	}
	/** Put the cursor at rest on `p` without motion. */
	place(p) {
		const pending = this.arrival;
		this.arrival = null;
		pending?.();
		this.pos = { ...p };
		this.heading = REST_HEADING;
		this.trajectory = null;
	}
	/** Move to `to`; resolves when the tip arrives (any settle keeps playing). */
	moveTo(to, opts = {}) {
		this.arrival?.();
		const req = {
			from: this.pos,
			fromHeading: this.heading,
			to,
			target: opts.target ?? null,
			seed: `player|${++this.moves}`,
			reducedMotion: opts.reducedMotion ?? false
		};
		this.trajectory = opts.spec ? planSpec(opts.spec, req) : planMove(opts.params ?? {}, req);
		this.motionT = 0;
		this.idleT = 0;
		this.pendingClick = !!opts.click;
		return new Promise((resolve$1) => this.arrival = resolve$1);
	}
	/** Show a click at the current tip. */
	click(effects = this.trajectory?.effects ?? {
		...NO_EFFECTS,
		ripple: true,
		squish: true
	}) {
		this.clickAge = 0;
		this.clickPoint = [this.pos.x, this.pos.y];
		this.clickEffects = effects;
	}
	destroy() {
		cancelAnimationFrame(this.raf);
	}
	frame = (now) => {
		const dt = this.last ? Math.min((now - this.last) / 1e3, .1) : 0;
		this.last = now;
		this.tick(dt * this.timeScale);
		this.paint();
		this.raf = requestAnimationFrame(this.frame);
	};
	tick(dt) {
		const traj = this.trajectory;
		if (traj) {
			this.motionT += dt;
			const s = traj.sampleAt(this.motionT);
			this.pos = {
				x: s.x,
				y: s.y
			};
			this.heading = s.heading;
			if (this.arrival && this.motionT >= traj.arrivalT) {
				if (this.pendingClick) {
					this.pendingClick = false;
					this.click(traj.effects);
				}
				const done = this.arrival;
				this.arrival = null;
				done();
			}
			if (this.motionT >= linger(traj)) this.trajectory = null;
		}
		this.idleT += dt;
		if (this.clickAge !== null) {
			this.clickAge += dt;
			if (this.clickAge >= CLICK_FX_SECS) this.clickAge = null;
		}
	}
	/** Effects at the current moment. */
	effectFrame() {
		const frame = this.trajectory ? motionFrame(this.trajectory, this.motionT, anchorForPointer(this.pos.x, this.pos.y, this.heading)) : emptyFrame();
		if (this.clickAge !== null) addClick(frame, this.clickEffects, this.clickAge, this.clickPoint);
		return frame;
	}
	paint() {
		const { canvas, g } = this;
		const dpr = window.devicePixelRatio || 1;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, w, h);
		this.options.drawScene?.(g, this);
		const fill = this.options.fill ?? CUA_BLUE;
		const f = this.effectFrame();
		drawEffectsUnder(g, f, fill);
		drawCursor(g, this.pos.x, this.pos.y, this.heading, {
			fill,
			squish: f.squish,
			floatT: this.options.float === false ? null : this.idleT
		});
		drawEffectsOver(g, f, fill);
	}
};

//#endregion
//#region src/driver.ts
const round = (v) => Math.round(v * 1e3) / 1e3;
/** Knobs that differ from the defaults, rounded for display. */
function changedKnobs(p) {
	const out = {};
	for (const key of Object.keys(DEFAULT_PARAMS)) {
		if (key === "effects") continue;
		const v = p[key];
		if (v !== DEFAULT_PARAMS[key]) out[key] = typeof v === "number" ? round(v) : v;
	}
	const effects = Object.fromEntries(EFFECT_NAMES.filter((n) => p.effects[n] != null).map((n) => [n, p.effects[n]]));
	if (Object.keys(effects).length) out.effects = effects;
	return out;
}
const SNAKE = {
	startHandle: "start_handle",
	endHandle: "end_handle",
	arcSize: "arc_size",
	arcFlow: "arc_flow",
	spring: "spring",
	glideDurationMs: "glide_duration_ms",
	turnRadius: "turn_radius"
};
/** Cua Driver equivalents of built-in style params. */
function driverSnippets(params, session = "demo") {
	const p = motionParams(params);
	const configSet = [`cua-driver config set cursor.motion.style ${p.style}`, `cua-driver config set cursor.motion.timing ${p.timing}`];
	const effectArgs = [];
	for (const n of EFFECT_NAMES) {
		const v = p.effects[n];
		if (v == null) continue;
		configSet.push(`cua-driver config set cursor.motion.effects.${n} ${v}`);
		effectArgs.push(`${n}=${v ? "on" : "off"}`);
	}
	let cursorMotion = `cua-driver cursor motion --session ${session} --style ${p.style} --timing ${p.timing}`;
	if (effectArgs.length) cursorMotion += ` --effects ${effectArgs.join(",")}`;
	if (p.glideDurationMs > 0) cursorMotion += ` --glide-ms ${round(p.glideDurationMs)}`;
	const call = {
		session,
		style: p.style,
		timing: p.timing
	};
	const callOnly = [];
	for (const [camel, snake] of Object.entries(SNAKE)) {
		const v = p[camel];
		if (v !== DEFAULT_PARAMS[camel]) {
			call[snake] = round(v);
			if (camel !== "glideDurationMs") callOnly.push(snake);
		}
	}
	if (effectArgs.length) call.effects = Object.fromEntries(EFFECT_NAMES.filter((n) => p.effects[n] != null).map((n) => [n, p.effects[n]]));
	return {
		configSet,
		cursorMotion,
		setAgentCursorMotion: call,
		callOnly
	};
}
/** TypeScript for planning these params with `@trycua/cursor-motion`. */
function paramsSnippet(params) {
	return [
		"import { planMove } from './vendor/cua-cursor-motion.js';",
		"",
		`const params = ${JSON.stringify(changedKnobs(motionParams(params)), null, 2)};`,
		"const trajectory = planMove(params, { from, to, target });"
	].join("\n");
}
/** TypeScript for a custom spec. */
function specSnippet(spec) {
	const r = (v) => typeof v === "number" ? round(v) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r(x)])) : v;
	return [
		"import { planSpec, type MotionSpec } from './vendor/cua-cursor-motion.js';",
		"",
		`const spec: MotionSpec = ${JSON.stringify(r(spec), null, 2)};`,
		"const trajectory = planSpec(spec, { from, to, target });"
	].join("\n");
}

//#endregion
export { CUA_BLUE, CURSOR_DISPLAY_SIZE, CURSOR_HOTSPOT, CURSOR_PATH, DEFAULT_FIXED_MS, DEFAULT_PARAMS, DEFAULT_TARGET_PT, DEFAULT_TRAIL, DT_MS, EASE_NAMES, EFFECT_NAMES, MOTION_STYLES, MOTION_TIMINGS, MotionPlayer, NO_EFFECTS, POINTER_ANCHOR_OFFSET, Path, REST_HEADING, Rng, Trajectory, anchorForPointer, bowPath, bumpProfile, clamp, cuaPath, cubicBezier, defaultEffects, defaultSpec, dist, drawCursor, drawEffectsOver, drawEffectsUnder, driverSnippets, durationMs, easeFn, effects_exports as effects, fittsDuration, fittsTimingMs, hashString, inOutCubic, inOutSine, knobShape, lerp, lerpPt, linear, minJerk, motionParams, naturalSide, outCubic, paramsSnippet, perp, planDubins, planMove, planSpec, pointerForAnchor, pt, resolveEffects, resolvedEffects, smootherstep, specForStyle, specSnippet, straightPath, timingFloorMs, unit, wobbleProfile, wrapAngle };