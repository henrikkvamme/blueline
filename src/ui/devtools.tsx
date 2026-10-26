import { useActorRef } from "@xstate/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { registry } from "../choices";
import { linkedReview } from "../io/link";
import { keptOf, loadKept, saveKept } from "../io/storage";
import {
  BINDINGS,
  commandBindings,
  dispatch,
  ownerOf,
  firstAction,
  nameOf,
  zoneOf,
  type Action,
  type Key,
  type View,
} from "../keys/keymap";
import { isKept } from "../notes/note";
import { liveMachine, shapesOf } from "../session/actors";
import { LAYERS, treeShown, type Layer as LayerName, type SessionActor } from "../session/machine";
import { pageJourney, pageParts, placeId } from "../part/page";
import {
  partOn,
  parts,
  variantOf,
  variantsOn,
  varietyOf,
  type Shown,
  type Verdicts,
} from "../part/store";
import type { DevAdapter, DevInfo, DevShift, JourneyInfo, StepInfo } from "../types";
import { Bar } from "./bar";
import { firstOpen, lastOpen } from "../session/state";
import { describe, PANEL, pathTo } from "./geometry";
import { Layer } from "./layers";
import { AimHint, Flash, Pins, Pointer, Shift, Light, toTop, useBox } from "./overlays";
import { NoteCard } from "./pinned";
import {
  now,
  ToolsContext,
  useNoteStep,
  usePins,
  useSession,
  useStep,
  useTools,
  type Snapshot,
  type Tools,
} from "./session";
import { Panel } from "./panel";
import { foldTree, openNextReply } from "./replies";
import { useVariantPlace } from "./step-controls";
import { release, settleGate, SETTLE_MS, TURN_MS, TURN_WAIT } from "./settle";
import { holdToggle } from "../keys/hold";
import { Toasts } from "./toasts";
import { finished } from "./tree";
import { VariantNote } from "./variant-note";
import { isPhone, useDockRoom, usePageFloor, usePhone, useSwipe } from "./touch";
import { focusToWrite, modeOf } from "../vim";

/*
 * The dev tools on a page: give them the app's adapter, and they walk its journeys, take
 * the reviewer's notes to the agent, and answer the keys. A page under them only names its
 * choices and commands (choices.ts).
 */

export interface DevToolsProps<C> {
  readonly adapter: DevAdapter<C>;
  /** Where the browser keeps the review. */
  readonly storageKey: string;
  /** The attributes that name an element well enough to point at it again. */
  readonly anchors?: readonly string[];
  /** The page's path, for a router that keeps it out of the address's path, as in its hash;
   * each path has its own notes. The address's path when none. */
  readonly path?: string | undefined;
  /** Goes to a page by its path, as `path` names it, for the tree's other pages. A new
   * address when none. */
  readonly navigate?: ((path: string) => void) | undefined;
  /** The app's own dev parts, which can start the review (useReviewControl). */
  readonly children?: React.ReactNode;
}

/** Where the settle is: while its motion plays, and until the next step shows, another
 * settle does nothing. */
const settling = settleGate();

/** On a phone, puts the lit part above the sheet or the bar, once, so the settle shows. */
function keepLit(target: string | undefined) {
  const lit = document.querySelector("[data-dt-light]")?.getBoundingClientRect();
  const element = target === undefined ? null : document.querySelector(target);
  if (!isPhone() || lit === undefined || !(element instanceof HTMLElement)) return;
  const tops = [...document.querySelectorAll("[data-dt-dock]")].map(
    (e) => e.getBoundingClientRect().top,
  );
  const floor = Math.min(window.innerHeight, ...tops);
  // The check stands at the light's top corner: that much must show.
  if (lit.top < 0 || lit.top + 32 > floor) toTop(element);
}

/** Whether the reviewer points at an element for a note, from the pin button or the `?` menu,
 * as Alt held does: the next click or tap picks it. */
let aimed = false;
const aimListeners = new Set<() => void>();
const aim = {
  current: () => aimed,
  set: (on: boolean) => {
    if (aimed === on) return;
    aimed = on;
    for (const l of aimListeners) l();
  },
  subscribe: (l: () => void) => {
    aimListeners.add(l);
    return () => void aimListeners.delete(l);
  },
};

const layerOf = (s: Snapshot): LayerName => {
  const value = s.value.layer;
  return LAYERS.find((l) => l === value) ?? "none";
};

const journeyIn = (s: Snapshot, adapter: DevInfo): JourneyInfo | undefined =>
  adapter.journeys.find((j) => j.id === s.context.journey) ?? adapter.journeys[0];

const stepIn = (s: Snapshot, adapter: DevInfo): StepInfo | undefined =>
  journeyIn(s, adapter)?.steps[s.context.at];

/** The verdicts on each part, by its name: the step's own over the other steps'. */
const verdictsIn = (s: Snapshot, adapter: DevInfo): Readonly<Record<string, Verdicts>> => {
  const step = stepIn(s, adapter)?.id;
  const others = Object.entries(s.context.feedback)
    .filter(([id]) => id !== step)
    .map(([, f]) => f.parts ?? {});
  return Object.assign({}, ...others, step === undefined ? {} : s.context.feedback[step]?.parts);
};

/** The variants with a note on the step, by the part's name. */
const notedIn = (s: Snapshot, adapter: DevInfo): Readonly<Record<string, readonly string[]>> => {
  const step = stepIn(s, adapter)?.id;
  const noted: Record<string, string[]> = {};
  for (const n of s.context.notes) {
    const on = n.pin?.variant;
    if (on === undefined || n.step !== step || !isKept(n)) continue;
    (noted[on.part] ??= []).push(on.variant);
  }
  return noted;
};

const viewOf = (s: Snapshot, adapter: DevInfo): View => {
  const step = stepIn(s, adapter);
  return {
    active: s.context.active,
    layer: layerOf(s),
    // The preview hides the panel, and it comes back with the tools.
    panel: s.context.panel && !s.context.preview,
    // The step's part's variants, else the step's own.
    variants: step === undefined ? 0 : variantsOn(step, journeyIn(s, adapter)),
    people: adapter.people !== undefined,
    preview: s.context.preview,
    aiming: aim.current(),
    finishing: s.context.finish !== null,
  };
};

/** The frames to wait for a field to draw: a note's card has none until its target is
 * measured, and the panel's chat none until the panel shows. */
const CARD_FRAMES = 30;

/** To write: in the open note's card, else in the panel's chat, once it draws. */
const focusComposer = (frames = CARD_FRAMES): void => {
  requestAnimationFrame(() => {
    const field =
      document.querySelector<HTMLElement>("[data-dt-composer=pinned]") ??
      document.querySelector<HTMLElement>("[data-dt-composer=step]");
    if (field === null && frames > 0) return focusComposer(frames - 1);
    focusToWrite(field);
  });
};

/** Whether the focus is in the panel: in its tree, on one of its buttons or in its chat. */
const inPanel = () => document.activeElement?.closest("[data-dt-panel]") != null;

/** The note field the preview hid, or Ctrl+B or Escape left for the tree, to come back to. */
let away: { readonly el: HTMLElement; readonly kind: string; readonly insert: boolean } | undefined;

/** Lets the note field that has the focus go, as the preview or Ctrl+B hides it or Escape
 * goes to the tree, and keeps it with its mode; the field keeps its cursor. */
function keepFocus() {
  const active = document.activeElement;
  // From the tree, the field it was left for is still the one to come back to.
  if (zoneOf(active) === "panel") return;
  const kind = active instanceof HTMLElement ? active.getAttribute("data-dt-composer") : null;
  away =
    active instanceof HTMLElement && kind !== null
      ? { el: active, kind, insert: modeOf(active) === "insert" }
      : undefined;
  away?.el.blur();
}

/** Back to the note field kept, at its place: in its mode, or to write with `insert`. Says
 * whether a field was kept; with none, the keys stay the page's. `noteOpen` says whether a
 * note's card is still open: its field comes back with the card, and the step's field takes
 * the keys only when the card closed. */
function comeBack(noteOpen: () => boolean, insert?: boolean): boolean {
  const was = away;
  away = undefined;
  if (was === undefined) return false;
  const restore = (frames: number): void => {
    requestAnimationFrame(() => {
      // The preview draws the field again, as a new element.
      const el = was.el.isConnected
        ? was.el
        : document.querySelector<HTMLElement>(`[data-dt-composer=${was.kind}]`);
      // The panel draws its chat again a frame after it shows.
      if (el === null && (was.kind !== "pinned" || noteOpen()) && frames > 0) {
        restore(frames - 1);
        return;
      }
      const field = el ?? document.querySelector<HTMLElement>("[data-dt-composer=step]");
      if (field === null) return;
      if (insert ?? was.insert) focusToWrite(field);
      else field.focus();
    });
  };
  restore(CARD_FRAMES);
  return true;
}

export function DevTools<C>({
  adapter,
  storageKey,
  anchors = ["data-review", "data-testid", "id"],
  path: given,
  navigate,
  children,
}: DevToolsProps<C>) {
  const [shift, setShift] = useState<DevShift | undefined>(undefined);
  const where = useRef(given);
  where.current = given;
  const pathNow = () => where.current ?? location.pathname;
  const goTo = useRef(navigate);
  goTo.current = navigate;
  // The page's path, then the parts on it that have variants: the page's own review has a
  // step for each.
  const onPage = useSyncExternalStore(parts.subscribe, () =>
    [pathNow(), ...pageParts(parts.current().instances)].join("\n"),
  );
  // The parts read what the adapter shows; only the machine runs its code.
  const info = useMemo<DevInfo>(
    () => ({
      ...adapter,
      journeys: [
        ...adapter.journeys,
        pageJourney(onPage.split("\n").slice(1), onPage.split("\n")[0]),
      ],
    }),
    [adapter, onPage],
  );
  const machine = useMemo(
    () => liveMachine({ adapter, shift: setShift, path: () => where.current ?? location.pathname }),
    [adapter],
  );
  const actor = useActorRef(machine, {
    input: {
      kept: loadKept(storageKey),
      journeys: shapesOf(info.journeys),
      now: now(),
      place: placeId(pathNow()),
    },
  });
  useEffect(() => {
    actor.send({ type: "journeys", journeys: shapesOf(info.journeys) });
  }, [actor, info]);
  // Each page has its own place for notes.
  const path = onPage.split("\n")[0] ?? "";
  useEffect(() => {
    actor.send({ type: "place", place: placeId(path) });
  }, [actor, path]);
  // A link from the agent starts its review, on its step, and leaves the address clean.
  useEffect(() => {
    const linked = linkedReview(location.href);
    if (linked === undefined) return;
    history.replaceState(history.state, "", linked.rest);
    const steps = info.journeys.find((j) => j.id === linked.journey)?.steps ?? [];
    const at = Math.max(
      0,
      steps.findIndex((s) => s.id === linked.step),
    );
    actor.send({ type: "start", journey: linked.journey, at, fresh: false });
  }, [actor, info]);
  useEffect(() => {
    const sub = actor.subscribe((s) => saveKept(storageKey, keptOf(s.context)));
    return () => sub.unsubscribe();
  }, [actor, storageKey]);
  // Undo and redo turn a step's light from the look it had, so the settle runs backwards.
  useEffect(() => {
    const done = actor.on("done", (e) => finished(e.journey));
    const sub = actor.on("undone", (e) => {
      const turned = e.turned;
      if (turned === undefined) return;
      settling.turn(turned);
      // A light that never shows, as in the preview, does not wait to turn.
      window.setTimeout(() => settling.turned(turned.step), TURN_WAIT);
    });
    return () => {
      done.unsubscribe();
      sub.unsubscribe();
    };
  }, [actor]);
  // The parts on the page show the reviewer's verdicts, as a deleted variant leaves the
  // lift, and which variants have a note.
  useEffect(() => {
    let was = "";
    let marked = "";
    const judge = (s: Snapshot) => {
      const verdicts = verdictsIn(s, info);
      const key = JSON.stringify(verdicts);
      if (key !== was) {
        was = key;
        parts.judge(verdicts);
      }
      const noted = notedIn(s, info);
      const marks = JSON.stringify(noted);
      if (marks !== marked) {
        marked = marks;
        parts.mark(noted);
      }
    };
    judge(actor.getSnapshot());
    const sub = actor.subscribe(judge);
    return () => sub.unsubscribe();
  }, [actor, info]);
  const tools = useMemo<Tools>(() => {
    const commands = () => [...(adapter.commands ?? []), ...registry.current().commands];
    /** Opens the step's note on a variant of a part, a new one if it has none. */
    const noteOn = (part: string, { variant, state }: Shown & { readonly variant: string }) => {
      const s = actor.getSnapshot();
      const on = stepIn(s, info);
      const same = s.context.notes.find(
        (n) =>
          n.step === on?.id &&
          n.pin?.variant?.part === part &&
          n.pin.variant.variant === variant &&
          n.pin.variant.state === state,
      );
      if (same !== undefined) return actor.send({ type: "pin", id: same.id });
      actor.send({
        type: "point",
        id: `pin-${now()}`,
        pin: {
          what: `${variant}, a variant of ${part}${state === undefined ? "" : `, ${state}`}`,
          // The part's own element shows its children only, so has no box: the card stands
          // by the step's target, which the part is in or round.
          selector: on?.target?.[0] ?? `[data-blueline-part="${part}"]`,
          variant: { part, variant, ...(state === undefined ? {} : { state }) },
        },
      });
    };
    /** The settle of the step at `at`, or its opening again. A settle keeps the variant the
     * step's part shows on the page, and sends the step's notes not sent yet at this time. */
    const settleOf = (at: number) => {
      const s = actor.getSnapshot();
      const journey = journeyIn(s, info);
      const part = partOn(journey?.steps[at], journey);
      if (part === undefined || part.labels.length <= 1) return {};
      const verdicts = parts.verdicts(part.name);
      const shown = parts.current().shown[part.name] ?? parts.shown(part.name);
      return { keep: { part: part.name, variant: variantOf(part.labels, shown, verdicts) } };
    };
    /** Settles the step at `at`, or opens it again. A settle shows that it took first: the
     * light turns green and its check draws, and then the walk goes on. While that plays, and
     * until the next step shows, another settle does nothing (settle.ts). A step the tree
     * selected is named when the page shows another. */
    const settle = (at: number) => {
      const s = actor.getSnapshot();
      const step = journeyIn(s, info)?.steps[at];
      if (step === undefined) return;
      const send = (keep: ReturnType<typeof settleOf>) =>
        actor.send({
          type: "settle",
          ...(at === actor.getSnapshot().context.at ? {} : { step: at }),
          ...keep,
          at: now(),
        });
      // Opening a settled step again goes at once; its light turns back where it is.
      if (s.context.feedback[step.id]?.settled === true) return send(settleOf(at));
      if (!settling.begin(step.id)) return;
      // The variant the reviewer saw as they settled.
      const keep = settleOf(at);
      const go = () => {
        const was = actor.getSnapshot().context;
        if (!was.active) return settling.reset();
        send(keep);
        const then = actor.getSnapshot().context;
        // The walk stayed, or ended: nothing is left to wait for.
        if (!then.active || (then.at === was.at && then.run === was.run)) settling.reset();
        else settling.sent(`${String(was.run)}-${String(was.at)}`);
      };
      const lit = document.querySelector("[data-dt-light]");
      if (at !== s.context.at || lit === null) return go();
      keepLit(step.target?.[0]);
      window.setTimeout(go, SETTLE_MS);
    };
    const noteOpen = () => actor.getSnapshot().context.opened !== undefined;
    const act = (action: Action) => {
      if (action.kind === "event") {
        if (action.event.type === "preview") {
          if (!actor.getSnapshot().context.preview) keepFocus();
          else {
            actor.send(action.event);
            comeBack(noteOpen);
            return;
          }
        }
        if (action.event.type === "settle") return settle(actor.getSnapshot().context.at);
        return actor.send(action.event);
      }
      // Pointing from a button shows the tools first, so the note's card can open.
      if (action.kind === "aim") {
        if (action.on && actor.getSnapshot().context.preview) actor.send({ type: "preview" });
        return aim.set(action.on);
      }
      // As Neovim's tree: l opens the selected row's children, goes down into them once
      // open, and on a row with none opens what it names. h closes them, or goes up to the
      // row it is under and closes that, and on a row under nothing goes up one row.
      // A key of the tree's that comes while it is folded unfolds it first.
      if (
        (action.kind === "tree" || action.kind === "row" || action.kind === "pick") &&
        !treeShown(actor.getSnapshot().context, isPhone())
      )
        return actor.send({ type: "tree", open: true });
      if (action.kind === "tree") {
        const rows = treeRows();
        const at = selectedRow(actor, rows);
        const row = rows[at];
        if (row === undefined) return;
        const open = row.getAttribute("aria-expanded");
        const fold = (el: HTMLElement, to: boolean) =>
          actor.send({ type: "fold", id: el.dataset.dtFold ?? "", open: to });
        const step = (by: number) => {
          const next = rows[at + by];
          if (next !== undefined) selectRow(actor, next);
        };
        if (action.open)
          return open === "false" ? fold(row, true) : open === "true" ? step(1) : row.click();
        if (open === "true") return fold(row, false);
        const parent = rows.find((r) => r.dataset.dtRow === row.dataset.dtParent);
        if (parent === undefined) return step(-1);
        selectRow(actor, parent);
        return fold(parent, false);
      }
      // y in the tree settles the step selected there; on any other row it does nothing.
      if (action.kind === "settleSelected") {
        const { active, row, cursor } = actor.getSnapshot().context;
        if (active && row === undefined) settle(cursor);
        return;
      }
      // A variant by its number in the panel's list: of the step's part, else the step's own.
      if (action.kind === "variantAt") {
        const { context } = actor.getSnapshot();
        const step = stepIn(actor.getSnapshot(), info);
        const part = partOn(step, journeyIn(actor.getSnapshot(), info));
        const left = part?.labels.filter((l) => !parts.verdicts(part.name).dropped.includes(l));
        if (part === undefined || left === undefined || left.length < 2) {
          const own = step?.variants?.length ?? 0;
          const shown = step === undefined ? 0 : (context.variants[step.id] ?? 0);
          if (action.at < own) actor.send({ type: "variant", by: action.at - shown });
          return;
        }
        const next = left[action.at];
        if (next !== undefined)
          parts.show(part.name, { variant: next, state: parts.shown(part.name).state });
        return;
      }
      // The variant beside the one the page shows: of the step's part, else the step's own.
      if (action.kind === "variant") {
        const step = stepIn(actor.getSnapshot(), info);
        const part = partOn(step, journeyIn(actor.getSnapshot(), info));
        const left = part?.labels.filter((l) => !parts.verdicts(part.name).dropped.includes(l));
        if (part === undefined || left === undefined || left.length < 2)
          return actor.send({ type: "variant", by: action.by });
        const shown = parts.shown(part.name);
        const at = left.indexOf(variantOf(part.labels, shown, parts.verdicts(part.name)));
        const next = left[(((at + action.by) % left.length) + left.length) % left.length];
        parts.show(part.name, { variant: next, state: shown.state });
        return;
      }
      if (action.kind === "lift") {
        const step = stepIn(actor.getSnapshot(), info);
        const part = partOn(step, journeyIn(actor.getSnapshot(), info));
        if (part === undefined || varietyOf(part, parts.verdicts(part.name)) === undefined)
          return actor.send(
            (step?.variants?.length ?? 0) > 1
              ? { type: "open", layer: "variants" }
              : { type: "unvaried" },
          );

        const { panel, preview } = actor.getSnapshot().context;
        parts.lift(part.id, {
          docked: panel && !preview && !isPhone() ? PANEL : 0,
          drop: (variant) => actor.send({ type: "drop", part: part.name, variant }),
          undo: () => actor.send({ type: "undo" }),
          note: (shown) => noteOn(part.name, shown),
          panel: <VariantNote tools={value} />,
        });
        return;
      }
      // R goes to what needs the reviewer: the next reply, else the notes on the page. With
      // no review on, the panel has the page's replies.
      if (action.kind === "reply") {
        if (!actor.getSnapshot().context.active) return actor.send({ type: "panel", shown: true });
        if (!openNextReply(actor)) actor.send({ type: "open", layer: "notes" });
        foldTree(actor);
        return;
      }
      // The tree's rows, as they show: this page's, the steps, then the journeys. A step row
      // is the step cursor; any other row is selected by its id.
      if (action.kind === "row" || action.kind === "pick") {
        const rows = treeRows();
        const now = selectedRow(actor, rows);
        if (action.kind === "pick") return rows[now]?.click();
        const from = now === -1 ? (action.by > 0 ? -1 : rows.length) : now;
        const next = rows[Math.min(Math.max(from + action.by, 0), rows.length - 1)];
        if (next !== undefined) selectRow(actor, next);
        return;
      }
      if (action.kind === "end") {
        const s = actor.getSnapshot();
        const ids = journeyIn(s, info)?.steps.map((st) => st.id) ?? [];
        const end = action.which === "first" ? firstOpen : lastOpen;
        return actor.send({ type: "jump", at: end(ids, s.context.feedback) });
      }
      if (action.kind === "command")
        return commands()
          .find((c) => c.id === action.id)
          ?.run();
      // Ctrl+B and the panel's button hide the panel, or show it again; the walk and the
      // light stay. A field in it is kept, and comes back with it, in its mode and place.
      if (action.kind === "panel") {
        const { panel, preview } = actor.getSnapshot().context;
        if (preview || !panel) {
          if (preview) actor.send({ type: "preview" });
          actor.send({ type: "panel", shown: true });
          comeBack(noteOpen);
          return;
        }
        if (inPanel()) keepFocus();
        actor.send({ type: "panel", shown: false });
        return act({ kind: "blur" });
      }
      if (action.kind === "blur" || (action.kind === "focus" && action.to === "page")) {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        return;
      }
      if (action.to === "note") {
        const { context } = actor.getSnapshot();
        if (context.preview) actor.send({ type: "preview" });
        // The message field is in the panel, under the tree.
        actor.send({ type: "panel", shown: true });
        foldTree(actor);
        // To the note opened from the tree, else back to the field the preview or the tree
        // took the keys from, to write.
        if (actor.getSnapshot().context.opened !== undefined) {
          away = undefined;
          focusComposer();
        } else if (!comeBack(noteOpen, true)) focusComposer();
        return;
      }
      // To the tree: it unfolds, so the reviewer sees where they are. The field left is kept,
      // so i comes back to it.
      keepFocus();
      if (actor.getSnapshot().context.preview) actor.send({ type: "preview" });
      actor.send({ type: "panel", shown: true });
      if (!treeShown(actor.getSnapshot().context, isPhone()))
        actor.send({ type: "tree", open: true });
      requestAnimationFrame(() => focusTree(actor));
    };
    // A key of the g menu closes it once it is done, also one that sends the session nothing,
    // as g g in the tree.
    const perform = (action: Action) => {
      const fromGo = layerOf(actor.getSnapshot()) === "go";
      act(action);
      if (fromGo && layerOf(actor.getSnapshot()) === "go") actor.send({ type: "close" });
    };
    const value: Tools = {
      actor,
      adapter: info,
      anchors,
      perform,
      navigate: (path) => (goTo.current ?? ((p: string) => location.assign(p)))(path),
    };
    return value;
  }, [actor, adapter, info, anchors]);
  // On a phone, the tools stand above the page's own bottom bar, and the page gets room to
  // scroll its end above the tools.
  const root = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  const floor = usePageFloor(phone);
  const room = useDockRoom(phone);
  useLayoutEffect(() => {
    root.current?.style.setProperty("--dt-floor", `${String(floor)}px`);
  }, [floor]);
  return (
    <ToolsContext.Provider value={tools}>
      <div ref={root} className="blueline">
        <Keys />
        <TreeFocus />
        <Review shift={shift} />
        <Toasts />
      </div>
      {children}
      {room > 0 && createPortal(<div aria-hidden style={{ height: room }} />, document.body)}
    </ToolsContext.Provider>
  );
}

/** The tree's rows as they show: this page's, the steps, then the journeys. */
const treeRows = () =>
  [...document.querySelectorAll<HTMLElement>("[data-dt-zone=panel] [data-dt-row]")].filter((r) =>
    r.checkVisibility(),
  );

/** Where the selected row is in the rows: a step row is the step cursor, any other row is
 * selected by its id; -1 when it does not show. */
function selectedRow(actor: SessionActor, rows: readonly HTMLElement[]): number {
  const { context } = actor.getSnapshot();
  return rows.findIndex((r) =>
    context.row === undefined
      ? r.dataset.step === String(context.cursor)
      : r.dataset.dtRow === context.row,
  );
}

function selectRow(actor: SessionActor, row: HTMLElement) {
  const step = row.dataset.step;
  if (step !== undefined)
    actor.send({ type: "cursor", by: Number(step) - actor.getSnapshot().context.cursor });
  else actor.send({ type: "row", id: row.dataset.dtRow ?? "" });
  row.scrollIntoView({ block: "nearest" });
}

/** Puts the keys in the tree, on a row that shows: the selected one, else the step the review
 * is on, else the first. */
function focusTree(actor: SessionActor) {
  document.querySelector<HTMLElement>("nav[data-dt-zone=panel]")?.focus({ preventScroll: true });
  const rows = treeRows();
  if (selectedRow(actor, rows) !== -1) return;
  const { active, at } = actor.getSnapshot().context;
  const row = (active ? rows.find((r) => r.dataset.step === String(at)) : undefined) ?? rows[0];
  if (row !== undefined) selectRow(actor, row);
}

/** Whether the focus is on nothing, or on the page's own element a click left it on, as a
 * button: the tree may take it. A field, a dialog or a list keeps it, and so does an
 * element the keyboard went to, as Tab does. */
function isLoose(at: Element | null): boolean {
  return (
    at === null ||
    at === document.body ||
    ((zoneOf(at) === "page" || zoneOf(at) === "control") && !at.matches(":focus-visible"))
  );
}

/** While the tree shows, it has the focus when no field has it, so j and k work at once. The
 * preview and the lift take the keys from it. Folded, as on a step, it gives them back to the
 * page, so h and l walk the steps. */
function TreeFocus() {
  const { actor } = useTools();
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { context } = actor.getSnapshot();
        if (!context.panel || context.preview || parts.current().lifting !== undefined) return;
        const at = document.activeElement;
        if (!treeShown(context, isPhone())) {
          if (zoneOf(at) === "panel" && at instanceof HTMLElement) at.blur();
          return;
        }
        if (isLoose(at)) focusTree(actor);
      });
    };
    check();
    document.addEventListener("focusout", check);
    const session = actor.subscribe(check);
    const lift = parts.subscribe(check);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusout", check);
      session.unsubscribe();
      lift();
    };
  }, [actor]);
  return null;
}

/** The keys, read on the window after the page's own handlers, but in the tree before them,
 * and Alt to point. */
function Keys() {
  const { actor, adapter, perform } = useTools();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const commands = [...(adapter.commands ?? []), ...registry.current().commands];
      const key = keyOf(e);
      const action = dispatch(
        [...BINDINGS, ...commandBindings(commands)],
        viewOf(actor.getSnapshot(), adapter),
        zoneOf(document.activeElement),
        key,
      );
      if (action === undefined) return;
      e.preventDefault();
      // Enter finishes only once it was let go after the finish showed.
      if (action.kind === "event" && action.event.type === "finish" && !enter.free()) return;
      perform(action);
      // p held shows the page only while it is down: its release shows the tools again.
      if (action.kind === "event" && action.event.type === "preview" && nameOf(key) === "p")
        peek.down(performance.now());
    };
    const peek = holdToggle();
    const peeked = () => {
      if (peek.up(performance.now())) perform({ kind: "event", event: { type: "preview" } });
    };
    const enter = release();
    const down = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.repeat) enter.down();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Enter") enter.up();
      if (e.key === "p" || e.key === "P") peeked();
    };
    const away = () => {
      enter.up();
      peeked();
    };
    let finishing = actor.getSnapshot().context.finish !== null;
    const watch = actor.subscribe((s) => {
      const now = s.context.finish !== null;
      if (now && !finishing) enter.shows();
      finishing = now;
    });
    // The tools' own keys go first, before the page and a field's handlers see them.
    const onFirstKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const action = firstAction(
        viewOf(actor.getSnapshot(), adapter),
        keyOf(e),
        ownerOf(document.activeElement),
      );
      if (action === undefined) {
        // The tree is the tools' own, so its keys, as Ctrl+K, do not reach the page.
        // The lift takes every key while it is up.
        if (zoneOf(document.activeElement) !== "panel" || parts.current().lifting !== undefined)
          return;
        onKey(e);
        if (e.defaultPrevented) e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      perform(action);
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", away);
    window.addEventListener("keydown", onFirstKey, true);
    window.addEventListener("keydown", onKey);
    return () => {
      watch.unsubscribe();
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", away);
      window.removeEventListener("keydown", onFirstKey, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [actor, adapter, perform]);
  return null;
}

/** A key press as the keymap reads it. */
const keyOf = (e: KeyboardEvent): Key => ({
  key: e.key,
  ctrl: e.ctrlKey,
  meta: e.metaKey,
  alt: e.altKey,
  shift: e.shiftKey,
  repeat: e.repeat,
});

/** Where the mouse is, so pointing starts on what is under it. */
function usePointerAt() {
  const at = useRef({ x: -1, y: -1 });
  useEffect(() => {
    const move = (e: PointerEvent) => {
      at.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", move, { capture: true, passive: true });
    return () => window.removeEventListener("pointermove", move, { capture: true });
  }, []);
  return at;
}

/** Whether the reviewer holds Alt to point, also from a field. A pick ends it until Alt is
 * pressed again, and so does another key, as Alt+2 types @ on a Norwegian Mac. */
function useAltHeld(on: boolean): readonly [boolean, () => void] {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) return setHeld(false);
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Alt") setHeld(false);
      else if (!e.repeat) setHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") setHeld(false);
    };
    const leave = () => setHeld(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", leave);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", leave);
    };
  }, [on]);
  return [held, () => setHeld(false)];
}

function Review({ shift }: { readonly shift: DevShift | undefined }) {
  const { actor, adapter, anchors, perform } = useTools();
  const active = useSession((s) => s.context.active);
  const ready = useSession((s) => s.matches({ review: { on: "ready" } }));
  const run = useSession((s) => s.context.run);
  const view = useSession((s) => viewOf(s, adapter), sameView);
  const opened = useSession((s) => s.context.opened);
  const preview = useSession((s) => s.context.preview);
  const { step, at } = useStep();
  // The notes are the step's, or the page's off a step or with its chat.
  const noteStep = useNoteStep();
  const pins = usePins(noteStep);
  const box = useBox(ready ? (step?.target ?? []) : [], `${run}-${at}`);
  const place = useVariantPlace();
  const pointerAt = usePointerAt();
  // Alt points also while the tools are hidden; the note brings the tools back.
  const [held, stopHolding] = useAltHeld((!active || ready) && shift === undefined);
  // The pin button points too, with no key held, as a finger has none.
  const aiming = useSyncExternalStore(aim.subscribe, aim.current);
  const pointing = held || aiming;
  const stopPointing = () => {
    stopHolding();
    aim.set(false);
  };
  // The flash shows on a step opened or built again while hidden, and on another variant
  // shown, not as the preview starts.
  // Once the step or the variant changes, every later one flashes, the first one's again too.
  const opening = `${run}-${at}-${place?.label ?? ""}`;
  const [hidden, setHidden] = useState<{ readonly on: string; readonly moved: boolean }>();
  if (!preview && hidden !== undefined) setHidden(undefined);
  if (preview && hidden === undefined) setHidden({ on: opening, moved: false });
  if (hidden !== undefined && !hidden.moved && hidden.on !== opening)
    setHidden({ ...hidden, moved: true });
  const flash = hidden !== undefined && (hidden.moved || hidden.on !== opening);
  const openedNote = pins.find((n) => n.id === opened);
  // A note on a variant shows in the lift while it is up, and beside the part when it is down.
  const lifted = useSyncExternalStore(parts.subscribe, () => parts.current().lifting) !== undefined;
  // A swipe across the part shows its next or previous variant, as j and k do.
  useSwipe(
    box,
    active && ready && view.variants > 1 && view.layer === "none" && !lifted && !pointing,
    (by) => perform({ kind: "variant", by }),
  );
  const point = (element: Element) => {
    stopPointing();
    if (noteStep === undefined) return;
    const selector = pathTo(element, anchors);
    const same = pins.find((n) => n.pin?.selector === selector);
    if (same !== undefined) return actor.send({ type: "pin", id: same.id });
    actor.send({
      type: "point",
      id: `pin-${now()}`,
      pin: { what: describe(element), selector },
    });
  };
  // A settled step's light is green with its check, and so is one whose settle plays. A
  // light that undo or redo took back shows its old look until it stands on the part, and
  // then turns.
  const key = `${String(run)}-${String(at)}`;
  const settledHere = useSession(
    (s) => step !== undefined && s.context.feedback[step.id]?.settled === true,
  );
  const motion = useSyncExternalStore(settling.subscribe, settling.current);
  const turning = useSyncExternalStore(settling.subscribe, settling.turning);
  const stepId = step?.id;
  const turns = turning !== undefined && turning.step === stepId;
  const look =
    turning !== undefined && turns
      ? turning.settled
      : settledHere || (motion.kind === "playing" && motion.step === stepId);
  // The step whose light stands on its part now.
  const standing = useRef("");
  const placed = (on: string) => {
    settling.shown(on);
    standing.current = on;
    if (on === key && stepId !== undefined && settling.turning()?.step === stepId)
      window.setTimeout(() => settling.turned(stepId), TURN_MS);
  };
  // Undo on the step that shows, as Back from the finish: the light already stands there.
  useEffect(() => {
    if (!turns || stepId === undefined || standing.current !== key) return;
    const turn = window.setTimeout(() => settling.turned(stepId), TURN_MS);
    return () => window.clearTimeout(turn);
  }, [turns, stepId, key]);
  // With the walk ended or the light hidden, nothing waits for the light.
  useEffect(() => {
    if (!active) settling.reset();
    else if (preview && ready) settling.shown(key);
  }, [active, preview, ready, key]);
  return (
    <>
      <Panel />
      {active && !preview && step !== undefined && (
        <Light
          box={box}
          at={key}
          ready={ready}
          settled={look}
          place={place}
          turning={turns}
          onPlaced={placed}
        />
      )}
      {active && ready && !preview && step !== undefined && (
        <>
          <Pins pins={pins} open={opened} onOpen={(id) => actor.send({ type: "pin", id })} />
          {openedNote !== undefined && (openedNote.pin?.variant === undefined || !lifted) && (
            <NoteCard note={openedNote} number={pins.indexOf(openedNote) + 1} />
          )}
        </>
      )}
      {!active && !preview && (
        <>
          <Pins pins={pins} open={opened} onOpen={(id) => actor.send({ type: "pin", id })} />
          {openedNote !== undefined && (
            <NoteCard note={openedNote} number={pins.indexOf(openedNote) + 1} />
          )}
        </>
      )}
      {active && ready && preview && box !== undefined && flash && (
        <Flash key={opening} box={box} place={place} />
      )}
      <Bar />
      <Layer view={view} />
      {shift !== undefined && <Shift shift={shift} />}
      {pointing && <Pointer at={pointerAt.current} onPick={point} />}
      {aiming && <AimHint onCancel={() => aim.set(false)} />}
    </>
  );
}

const sameView = (a: View, b: View) =>
  a.active === b.active &&
  a.layer === b.layer &&
  a.panel === b.panel &&
  a.variants === b.variants &&
  a.people === b.people &&
  a.preview === b.preview &&
  a.aiming === b.aiming &&
  a.finishing === b.finishing;

/** Starts the review from the app's own dev parts, as a link or another tool asks. */
export function useReviewControl() {
  const { actor } = useTools();
  return useMemo(
    () => ({
      start: (journey: string, at: number, fresh: boolean) =>
        actor.send({ type: "start", journey, at, fresh }),
    }),
    [actor],
  );
}
