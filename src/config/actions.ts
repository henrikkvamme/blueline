import { markSent } from "../keys/sent";
import type { Action, PressAction } from "./index";

/*
 * A config's actions on the page. Each action that names an element waits for it first. An
 * action may load a new page, as a click on a link does: the walk keeps, for the tab, which
 * of the step's actions ended, so the step goes on at the first action that did not end on
 * the new page (config/cursor.ts).
 */

/** Says what an action waits for, for the reason when it is too late. */
export type Doing = (what: string) => void;

/** Ends when the signal aborts, with its reason. */
const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, fail) => {
    if (signal.aborted) return fail(signal.reason);
    signal.addEventListener("abort", () => fail(signal.reason), { once: true });
  });

/** The first element that matches the selector, once there is one. */
export function waitFor(selector: string, signal: AbortSignal, doing: Doing): Promise<Element> {
  const found = document.querySelector(selector);
  if (found !== null) return Promise.resolve(found);
  doing(`no element matches ${selector}`);
  return new Promise<Element>((done, fail) => {
    const look = () => {
      const el = document.querySelector(selector);
      if (el === null) return;
      watch.disconnect();
      done(el);
    };
    const watch = new MutationObserver(look);
    watch.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    aborted(signal).catch((reason: unknown) => {
      watch.disconnect();
      fail(reason);
    });
  });
}

/** Whether the address is the path's already, as a link from this page names it. */
const there = (path: string) => {
  const url = new URL(path, location.href);
  return (
    url.origin === location.origin &&
    url.pathname + url.search === location.pathname + location.search
  );
};

/** The browser's own setter of a field's value, as a framework such as React reads it. */
function setValue(field: Element, text: string) {
  const kind =
    field instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : field instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : undefined;
  if (kind === undefined || !(field instanceof HTMLElement))
    throw new Error("type needs an input, a textarea or a select");
  field.focus();
  // The kind's own setter, with the field as `this`: React keeps its own on the field.
  Reflect.set(kind, "value", text, field);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Sends the key down and up. Enter on a field in a form that no handler stopped submits the
 * form, as these events have no default action in a browser. */
function press(target: Element, action: PressAction) {
  const init: KeyboardEventInit = {
    key: action.press,
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: action.shift ?? false,
    ctrlKey: action.ctrl ?? false,
    altKey: action.alt ?? false,
    metaKey: action.meta ?? false,
  };
  const down = markSent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(down);
  if (
    action.press === "Enter" &&
    !down.defaultPrevented &&
    target instanceof HTMLInputElement &&
    target.form !== null
  )
    target.form.requestSubmit();
  target.dispatchEvent(markSent(new KeyboardEvent("keyup", init)));
}

function click(el: Element) {
  if (el instanceof HTMLElement) el.click();
  else
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
}

/** Runs one action. `open` loads a new page, so it does not end on this one. */
export async function runAction(action: Action, signal: AbortSignal, doing: Doing): Promise<void> {
  if ("open" in action) {
    if (there(action.open)) return;
    location.assign(new URL(action.open, location.href));
    doing(`the page did not load ${action.open}`);
    return aborted(signal);
  }
  if ("click" in action) return click(await waitFor(action.click, signal, doing));
  if ("type" in action) return setValue(await waitFor(action.into, signal, doing), action.type);
  if ("press" in action) {
    const target =
      action.on === undefined
        ? (document.activeElement ?? document.body)
        : await waitFor(action.on, signal, doing);
    return press(target, action);
  }
  if ("wait" in action) return void (await waitFor(action.wait, signal, doing));
  window.dispatchEvent(new CustomEvent(action.emit, { detail: action.detail }));
}
