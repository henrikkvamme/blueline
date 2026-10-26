// Vim keys for one dev tool field. A capture-phase keydown listener on the field runs each key
// through the engine before the caller's own onKeyDown sees it: keys vim handles stop there, and
// the rest (Enter, Cmd+Enter, Tab) reach the field and the caller as usual.
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { cursorOf, keepCursor } from "../io/cursors";
import { clampNormal, initialVim, vimKey, type Mode, type Register, type VimState } from "./engine";
import { afterPointer, apply, docOf, show, type Placed, type VimField } from "./field";
import { focused as focusedElement } from "../core/root";
import { isSent } from "../keys/sent";

export type VimOptions = {
  enabled: boolean;
  /** Esc in normal mode, with no command pending: the caller leaves the field. */
  onEscape?: () => void;
  /** The field's name, to keep where its cursor was, as `composer:<note id>`. */
  memory?: string;
};

// One register for every field, as vim has.
let register: Register = { text: "", linewise: false };

// Whether the next field to get the focus starts in insert mode.
let writeNext = false;

// How long after a finger's press the field's focus counts as the tap's.
const TAP_MS = 1000;

// The fields with vim's keys, each with how it starts to write while it has the focus.
const writers = new WeakMap<HTMLElement, () => void>();

// The fields with vim's keys, each with its mode now.
const modes = new WeakMap<HTMLElement, () => Mode>();

/** The mode of a field with vim's keys, to come back to it in the same mode. */
export const modeOf = (el: HTMLElement): Mode | undefined => modes.get(el)?.();

/** Focuses a field to write in it: it starts in insert mode, as `i` in nvim. Any other
 *  focus starts in normal mode. A field that has the focus already gets no focus event, so it
 *  starts to write in place. */
export function focusToWrite(el: HTMLElement | null) {
  if (el === null) return;
  const write = writers.get(el);
  if (focusedElement() === el && write !== undefined) return write();
  writeNext = true;
  el.focus();
  writeNext = false;
}

/** Gives the field in `ref` vim's keys while `enabled`, and returns its mode for a badge while
 *  it has the focus. The field must be mounted when `enabled` turns on. */
export function useVim(
  ref: { readonly current: VimField | null },
  options: VimOptions,
): Mode | undefined {
  const [mode, setMode] = useState<Mode>("normal");
  const [focused, setFocused] = useState(false);
  const state = useRef<VimState>(initialVim("normal"));
  const placed = useRef<Placed | undefined>(undefined);
  // Whether a press gave the focus: the press puts the cursor, not the kept place.
  const pressed = useRef(false);
  // When a finger last pressed the field: a phone has no Escape or i, so a tap starts to
  // write. A tap's focus comes after the finger leaves, so the press counts for a moment.
  const touched = useRef(Number.NEGATIVE_INFINITY);
  const byTouch = () => performance.now() - touched.current < TAP_MS;
  // The mode of a field whose keys went off while it kept the focus.
  const resumed = useRef<VimState | undefined>(undefined);

  const set = (next: VimState) => {
    state.current = next;
    setMode(next.mode);
  };

  // A field starts in normal mode, as nvim does, at the place it was left; one opened to
  // write starts in insert mode.
  const enter = (el: VimField) => {
    const next = initialVim(writeNext || byTouch() ? "insert" : "normal");
    set(next);
    placed.current = undefined;
    if (pressed.current) return;
    const kept = options.memory === undefined ? undefined : cursorOf(options.memory);
    const at = kept ?? el.value.length;
    placed.current = show(el, next, next.mode === "normal" ? clampNormal(el.value, at) : at);
  };

  const keep = (el: VimField) => {
    if (options.memory === undefined) return;
    // In insert mode the browser moves the caret as the reviewer types, past the kept place.
    const caret = el.selectionStart ?? 0;
    keepCursor(
      options.memory,
      state.current.mode === "insert" ? caret : (placed.current?.cursor ?? caret),
    );
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const el = ref.current;
    if (!el || e.isComposing || e.defaultPrevented || isSent(e)) return;
    const s = { ...state.current, register };
    const r = vimKey(s, docOf(el, s, placed.current), e);
    if (!r.handled) {
      set(r.state);
      // Esc in normal mode is the caller's: it leaves the field.
      if (e.key === "Escape" && r.state.mode === "normal" && options.onEscape) {
        e.preventDefault();
        e.stopPropagation();
        options.onEscape();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    register = r.state.register;
    placed.current = apply(el, r);
    set(r.state);
  });

  const onPointerUp = useEffectEvent(() => {
    const el = ref.current;
    if (!el || state.current.mode === "insert") return;
    // The browser moves the selection after the press ends. A tap's focus comes after the
    // finger leaves, and may start to write meanwhile.
    requestAnimationFrame(() => {
      if (state.current.mode === "insert") return;
      const next = afterPointer(el, state.current);
      placed.current = next.placed;
      set(next.state);
    });
  });

  const onFocus = useEffectEvent(() => {
    setFocused(true);
    if (ref.current) enter(ref.current);
    pressed.current = false;
    touched.current = Number.NEGATIVE_INFINITY;
  });
  // A tap on the field that has the focus already writes too, at the place it puts the caret.
  const onTouch = useEffectEvent(() => {
    const el = ref.current;
    if (!el || state.current.mode === "insert") return;
    pressed.current = true;
    touched.current = performance.now();
    enter(el);
    pressed.current = false;
    touched.current = Number.NEGATIVE_INFINITY;
  });
  const onWrite = useEffectEvent(() => {
    if (!ref.current) return;
    writeNext = true;
    enter(ref.current);
    writeNext = false;
  });
  const onBlur = useEffectEvent(() => {
    setFocused(false);
    if (ref.current) keep(ref.current);
    pressed.current = false;
    placed.current = undefined;
    set(initialVim("normal"));
  });

  useEffect(() => {
    const el = ref.current;
    if (!options.enabled || !el) return;
    // The listeners go on the element as one type: the field's union has no single overload.
    const node: HTMLElement = el;
    const key = (e: KeyboardEvent) => onKey(e);
    const pointer = () => onPointerUp();
    const press = (e: PointerEvent) => {
      const hasFocus = focusedElement() === node;
      if (!hasFocus) pressed.current = true;
      if (e.pointerType !== "touch") return;
      if (hasFocus) onTouch();
      else touched.current = performance.now();
    };
    const focus = () => onFocus();
    const blur = () => onBlur();
    node.addEventListener("keydown", key, true);
    node.addEventListener("pointerdown", press);
    node.addEventListener("pointerup", pointer);
    node.addEventListener("focus", focus);
    node.addEventListener("blur", blur);
    writers.set(node, () => onWrite());
    modes.set(node, () => state.current.mode);
    // Keys that come back on a field with the focus keep its mode: React's StrictMode turns
    // a new field's effects off and on again, after the caller focused it to write.
    const was = resumed.current;
    resumed.current = undefined;
    if (was !== undefined && focusedElement() === node) {
      set(was);
      const at = el.selectionStart ?? el.value.length;
      placed.current = show(el, was, was.mode === "normal" ? clampNormal(el.value, at) : at);
    }
    return () => {
      writers.delete(node);
      modes.delete(node);
      node.removeEventListener("keydown", key, true);
      node.removeEventListener("pointerdown", press);
      node.removeEventListener("pointerup", pointer);
      node.removeEventListener("focus", focus);
      node.removeEventListener("blur", blur);
      // A field that goes while it has the focus gets no blur, so its place is kept here.
      if (focusedElement() === el) {
        keep(el);
        // Turning vim off leaves a plain caret, not a block.
        if (state.current.mode !== "insert") show(el, initialVim(), el.selectionStart ?? 0);
        resumed.current = state.current;
      }
      placed.current = undefined;
      state.current = initialVim("normal");
      setMode("normal");
    };
  }, [ref, options.enabled]);

  return options.enabled && focused ? mode : undefined;
}
