import { Effect, Fiber } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRegistry } from "../choices";
import {
  BINDINGS,
  CARD_KEYS,
  bindingsFor,
  commandBindings,
  goBindings,
  helpRows,
  rowAction,
  zoneOf,
  type View,
} from "../keys/keymap";
import { isKept } from "../notes/note";
import { UI } from "./geometry";
import { fromResult } from "../core/result";
import type { DevInfo, DevPersonChoice } from "../types";
import { Palette, type Item } from "./palette";
import { useJourneys, useThisPage } from "./tree";
import { usePins, useSession, useStep, useTools } from "./session";
import { focused, targetOf } from "../core/root";

/*
 * What opens over the page, one at a time: the pickers, the replies, the key menu and the
 * send sheet.
 */

const close = { type: "close" } as const;

/** The step's own states: what its `variants` set up on the page, as data, not a look of a
 * part. Only this step's, as the walk shows one step at a time. */
function Variants() {
  const { actor } = useTools();
  const { step } = useStep();
  const current = useSession((s) => (step === undefined ? 0 : (s.context.variants[step.id] ?? 0)));
  const items = (step?.variants ?? []).map((v, i) => ({
    id: v.label,
    label: v.label,
    current: i === current,
  }));
  return (
    <Palette
      label={`States of “${step?.title ?? ""}”`}
      items={items}
      empty="This step has one state."
      onClose={() => actor.send(close)}
      onChoose={(item) => {
        if (step !== undefined) actor.send({ type: "showVariant", step: step.id, label: item.id });
        actor.send(close);
      }}
    />
  );
}

/** The step's pointed notes. */
function Pointed() {
  const { actor } = useTools();
  const { step } = useStep();
  const pins = usePins(step?.id);
  const items = pins.map((n, i) => ({
    id: n.id,
    label: `${i + 1}. ${isKept(n) ? n.draft : (n.thread.at(-1)?.text ?? "Empty")}`,
    detail: n.pin?.what,
  }));
  return (
    <Palette
      label="Annotations on this step"
      items={items}
      empty="No annotations yet. Point at an element to write one."
      onClose={() => actor.send(close)}
      onChoose={(item) => actor.send({ type: "pin", id: item.id })}
    />
  );
}

/** People to act as, from the app. */
function People({ people }: { readonly people: NonNullable<DevInfo["people"]> }) {
  const { actor } = useTools();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<readonly DevPersonChoice[]>([]);
  // A new query stops the last search: its signal aborts, and its result is dropped.
  useEffect(() => {
    const fiber = Effect.runFork(
      fromResult((signal) => people.find(query, signal)).pipe(
        Effect.tap((list) => Effect.sync(() => setFound(list))),
        Effect.catchCause((cause) => Effect.logError("The dev tools could not find people", cause)),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [people, query]);
  return (
    <Palette
      label="Act as"
      items={found.map((p) => ({
        id: p.id,
        label: p.name,
        detail: p.detail,
        current: p.current,
        group: p.group ?? "Everyone",
      }))}
      empty="Nobody found."
      onQuery={setQuery}
      onClose={() => actor.send(close)}
      onChoose={(item) => {
        people.actAs(item.id);
        actor.send(close);
      }}
    />
  );
}

/** The keys that work now and the app's commands. Choosing one does what it does. */
function Help({ view }: { readonly view: View }) {
  const { actor, adapter, perform } = useTools();
  const { commands: registered, choices } = useRegistry();
  const commands = useMemo(
    () => [...(adapter.commands ?? []), ...registered],
    [adapter.commands, registered],
  );
  const bindings = [...BINDINGS, ...commandBindings(commands)];
  // The g menu's keys show as g g, and g itself, which only opens that menu, does not. The
  // keys are the page's, so g g is the page's too.
  const keyed = [
    ...bindingsFor(bindings, { ...view, layer: "none" }, "page"),
    ...goBindings(bindings, { ...view, layer: "none" }, "page"),
  ].filter(
    (b) =>
      b.does !== undefined &&
      !(b.group === "Tools" && (b.keys.includes("?") || b.keys.includes("g"))),
  );
  const rows = helpRows(keyed);
  const items: Item[] = [
    ...rows.map((row, i) => ({
      id: `key-${i}`,
      label: row.label,
      key: row.key,
      group: row.binding.group,
    })),
    {
      id: "point",
      label: "Put a pin on an element, with an annotation",
      key: "Alt+click",
      group: "Chat",
    },
    // A pin's note card takes these keys in its field.
    ...CARD_KEYS.map((k) => ({ id: `card-${k.id}`, label: k.label, key: k.key, group: "Chat" })),
    ...commands
      .filter((c) => c.key === undefined)
      .map((c) => ({ id: `command-${c.id}`, label: c.title, group: c.group ?? "Commands" })),
    // The page's design choices, so a design can change with no review running.
    ...choices.flatMap((c) =>
      c.options.map((option) => ({
        id: `choice-${c.name}-${option}`,
        label: option,
        group: c.name,
        current: option === c.value,
      })),
    ),
  ].sort((a, b) => rank(a.group) - rank(b.group));
  return (
    <Palette
      label="Keys and commands"
      items={items}
      empty="Nothing matches."
      onClose={() => actor.send(close)}
      onChoose={(item) => {
        actor.send(close);
        if (item.id.startsWith("command-"))
          return commands.find((c) => `command-${c.id}` === item.id)?.run();
        if (item.id.startsWith("choice-"))
          return choices.find((c) => c.name === item.group)?.choose(item.label);
        if (item.id === "point") return perform({ kind: "aim", on: true });
        // The card's keys work only in its field.
        if (item.id.startsWith("card-")) return;
        const row = rows[Number(item.id.slice(4))];
        if (row !== undefined) perform(rowAction(row));
      }}
    />
  );
}

const GROUPS: readonly string[] = ["Review", "Chat", "Panel", "Tools"];
/** The tools' own groups first, then the app's. */
const rank = (group: string | undefined) => {
  const i = GROUPS.indexOf(group ?? "");
  return i < 0 ? GROUPS.length : i;
};

/** The journeys, to pick one to review: the one on now, the open ones, then the done ones. */
function Journeys({ view }: { readonly view: View }) {
  const { actor } = useTools();
  const { journeys, settledIn, start } = useJourneys();
  const current = useSession((s) => (s.context.active ? s.context.journey : undefined));
  const items = journeys
    .map((j) => ({
      id: j.id,
      label: j.title,
      detail: `${String(settledIn(j))}/${String(j.steps.length)}`,
      current: j.id === current,
      group: settledIn(j) === j.steps.length ? "Done" : "Open",
    }))
    .sort((a, b) => Number(a.group === "Done") - Number(b.group === "Done"));
  return (
    <Palette
      label={view.active ? "Journeys: go to another" : "Journeys: start a review"}
      items={items}
      empty="This app has no journeys."
      onClose={() => actor.send(close)}
      onChoose={(item) => {
        actor.send(close);
        const journey = journeys.find((j) => j.id === item.id);
        if (journey !== undefined) start(journey);
      }}
    />
  );
}

/** This page's chat, notes and parts, as the tree shows them; a choice does what a click
 * there does. */
function Here() {
  const { actor } = useTools();
  const { chat, pins, parts, feedback, openChat, openPin, openPart } = useThisPage();
  const items: Item[] = [
    ...(chat === undefined
      ? []
      : [{ id: "chat", label: chat.thread.at(-1)?.text ?? "Chat", group: "Chat" }]),
    // A sent note is in the chat, with its replies.
    ...pins.map((n) => ({
      id: `pin-${n.id}`,
      label: n.draft,
      detail: n.pin?.what,
      group: "Not sent",
    })),
    ...parts.map((step, i) => ({
      id: `part-${String(i)}`,
      label: step.title,
      detail: feedback[step.id]?.settled === true ? "Settled" : undefined,
      group: "Parts",
    })),
  ];
  return (
    <Palette
      label="This page"
      items={items}
      empty="No annotations on this page."
      onClose={() => actor.send(close)}
      onChoose={(item) => {
        actor.send(close);
        if (item.id === "chat") return openChat();
        if (item.id.startsWith("pin-")) return openPin(item.id.slice(4));
        openPart(Number(item.id.slice(5)));
      }}
    />
  );
}

/** The g menu, as LazyVim's which-key: what the key after g does. It takes no focus, so the
 * next key reaches the keys; a click does the same as the key. */
function Go({ view }: { readonly view: View }) {
  const { actor, perform } = useTools();
  // The keys after g from where the keys are, as g g, the top row in the tree.
  const items = goBindings(BINDINGS, view, zoneOf(focused()));
  const menu = useRef<HTMLDivElement>(null);
  // A press outside closes it, as any other key does.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const at = targetOf(e);
      if (at instanceof Node && menu.current?.contains(at) !== true) actor.send(close);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [actor]);
  return (
    <div
      ref={menu}
      {...UI}
      aria-label="After g"
      className="fixed bottom-16 left-1/2 z-[2147483003] flex min-w-56 -translate-x-1/2 flex-col gap-0.5 rounded-dt-panel bg-dt-panel p-1 text-[13px] text-dt-text shadow-dt-float max-sm:bottom-(--dt-above-bar) max-sm:text-[15px]"
    >
      {items.map((b) =>
        b.keys.map((k) => (
          <button
            key={k}
            type="button"
            className="flex items-center gap-3 rounded-dt-control px-2 py-1.5 text-left hover:bg-dt-raised max-sm:min-h-11"
            onClick={() => perform(typeof b.does === "function" ? b.does(k) : b.does)}
          >
            <kbd className="rounded-dt-mark bg-dt-ground px-1.5 py-px font-mono text-[11px] text-dt-muted">
              g {k}
            </kbd>
            {b.label}
          </button>
        )),
      )}
    </div>
  );
}

export function Layer({ view }: { readonly view: View }) {
  const layer = view.layer;
  const people = useTools().adapter.people;
  if (layer === "variants") return <Variants />;
  if (layer === "notes") return <Pointed />;
  if (layer === "people" && people !== undefined) return <People people={people} />;
  if (layer === "help") return <Help view={view} />;
  if (layer === "go") return <Go view={view} />;
  if (layer === "journeys") return <Journeys view={view} />;
  if (layer === "here") return <Here />;
  return null;
}
