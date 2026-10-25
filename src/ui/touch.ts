import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Box } from "./geometry";
import { swipeOf, swipeStarts, type Point } from "./swipe";

/*
 * The tools on a phone: whether the screen is a phone's, the swipe on the part under review,
 * and the room the page's own bottom bar takes, which the tools stand above. A phone is a
 * narrow screen, as Tailwind's `max-sm:`, so the desktop keeps its look.
 */

const PHONE = "(width < 40rem)";

const watchPhone = (changed: () => void) => {
  const query = matchMedia(PHONE);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};

/** Whether the screen is a phone's now. */
export const isPhone = () => matchMedia(PHONE).matches;

/** Whether the screen is a phone's: the cards then stand as sheets above the bar. */
export const usePhone = () => useSyncExternalStore(watchPhone, isPhone);

/** Whether the device has no mouse or trackpad, only a finger. */
export const isTouch = () => matchMedia("(pointer: coarse)").matches;

const within = (p: Point, b: Box) =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** Whether the element, or one it is in, scrolls sideways itself, as a wide table: a swipe
 * there is the page's. */
function scrollsAcross(element: Element | null): boolean {
  for (let e = element; e !== null; e = e.parentElement) {
    if (e.scrollWidth <= e.clientWidth + 1) continue;
    const overflow = getComputedStyle(e).overflowX;
    if (overflow === "auto" || overflow === "scroll" || e === document.documentElement) return true;
  }
  return false;
}

const pointOf = (t: Touch | undefined): Point | undefined =>
  t === undefined ? undefined : { x: t.clientX, y: t.clientY };

/**
 * Calls `onSwipe` when one finger swipes across `box`, read when the touch starts. The
 * listeners are passive touch events on the window: they never stop the page's scroll, and,
 * unlike pointer events, they go on while the page scrolls.
 */
export function useSwipe(box: Box | undefined, on: boolean, onSwipe: (by: 1 | -1) => void): void {
  const latest = useRef({ box, onSwipe });
  latest.current = { box, onSwipe };
  useEffect(() => {
    if (!on) return;
    let from: Point | undefined;
    let last: Point | undefined;
    const start = (e: TouchEvent) => {
      from = undefined;
      const at = pointOf(e.touches[0]);
      const box = latest.current.box;
      const target = e.target instanceof Element ? e.target : null;
      if (e.touches.length !== 1 || at === undefined || box === undefined) return;
      if (!within(at, box) || !swipeStarts(at, window.innerWidth)) return;
      if (target?.closest("[data-dt-ui]") != null || scrollsAcross(target)) return;
      from = at;
      last = at;
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 1) from = undefined;
      else last = pointOf(e.touches[0]) ?? last;
    };
    const end = (e: TouchEvent) => {
      const to = pointOf(e.changedTouches[0]) ?? last;
      const was = from;
      from = undefined;
      if (was === undefined || to === undefined) return;
      const by = swipeOf(was, to);
      if (by !== undefined) latest.current.onSwipe(by);
    };
    const cancel = () => {
      from = undefined;
    };
    const options = { capture: true, passive: true } as const;
    window.addEventListener("touchstart", start, options);
    window.addEventListener("touchmove", move, options);
    window.addEventListener("touchend", end, options);
    window.addEventListener("touchcancel", cancel, options);
    return () => {
      window.removeEventListener("touchstart", start, options);
      window.removeEventListener("touchmove", move, options);
      window.removeEventListener("touchend", end, options);
      window.removeEventListener("touchcancel", cancel, options);
    };
  }, [on]);
}

/** Whether an element is the page's, not the tools'. */
const isPage = (e: Element) => e.closest("[data-dt-ui], .blueline, .blueline-portal") === null;

/**
 * The height of the page's own bar at the bottom of the screen, as a form's sticky Back and
 * Review: a fixed or sticky element of the page that stands on the screen's bottom edge. The
 * tools stand above it, so they cover none of its buttons.
 */
function pageFloor(): number {
  const height = window.innerHeight;
  let floor = 0;
  for (const x of [8, window.innerWidth / 2, window.innerWidth - 8]) {
    for (const hit of document.elementsFromPoint(x, height - 1).filter(isPage)) {
      for (let e: Element | null = hit; e !== null && e !== document.body; e = e.parentElement) {
        const position = getComputedStyle(e).position;
        if (position !== "fixed" && position !== "sticky") continue;
        const rect = e.getBoundingClientRect();
        if (rect.bottom >= height - 2 && rect.height < height / 3)
          floor = Math.max(floor, height - rect.top);
        break;
      }
    }
  }
  return Math.round(floor);
}

/**
 * How much room the tools' dock takes on a phone: from the top of the highest sheet to the
 * bottom of the bar, with a gap. The page gets as much more room to scroll at its end, so
 * its last part, and its own bottom bar, can stand above the dock.
 */
function dockRoom(): number {
  let top = Infinity;
  let bottom = -Infinity;
  for (const e of document.querySelectorAll("[data-dt-dock]")) {
    const rect = e.getBoundingClientRect();
    if (rect.height === 0) continue;
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  return top === Infinity ? 0 : Math.round(bottom - top + 16);
}

/** A measure of the screen, while `on`, kept up to date as the page scrolls and changes. */
function useMeasure(on: boolean, measure: () => number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!on) return setValue(0);
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setValue(measure()));
    };
    update();
    const every = window.setInterval(update, 500);
    window.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(every);
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [on, measure]);
  return value;
}

/** The page's bottom bar's height while `on`. */
export const usePageFloor = (on: boolean) => useMeasure(on, pageFloor);

/** The room the tools' dock takes while `on`. */
export const useDockRoom = (on: boolean) => useMeasure(on, dockRoom);
