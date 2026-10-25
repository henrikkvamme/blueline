import type { Event, Layer } from "../session/machine";

/*
 * Every key of the dev tools, in one list. The dispatcher reads it to act on a key, and the
 * `?` menu reads it to show the keys that work now, so the menu never shows a key that does
 * nothing or hides one that does something.
 *
 * What a key does depends on where the focus is, its zone, read from the page when the key
 * comes: h, j, k and l walk the review on the page, and move the selection in the panel's tree.
 * g opens the g menu, as LazyVim's which-key: the key after it, as m in g m, does the thing.
 */

/** Where the focus is. A field and an open list (a picker, the menu) keep their keys. */
export type Zone = "page" | "panel" | "field" | "list";

/** What the keys need to know of the session. */
export interface View {
  readonly active: boolean;
  readonly layer: Layer;
  /** Whether the panel shows. */
  readonly panel: boolean;
  /** How many variants the step has. */
  readonly variants: number;
  /** Whether the app can act as someone else. */
  readonly people: boolean;
  /** Whether the tools hide, so the reviewer sees the page as a user does. */
  readonly preview: boolean;
  /** Whether the reviewer points at an element for a note, from the pin button. */
  readonly aiming?: boolean | undefined;
}

/** What a key does: a session event, or something on the page. */
export type Action =
  | { readonly kind: "event"; readonly event: Event }
  /** Puts the keys in a message field, in the panel's tree, which unfolds, or on the page. */
  | { readonly kind: "focus"; readonly to: "note" | "panel" | "page" }
  | { readonly kind: "blur" }
  /** Hides the panel, or shows it again; the walk and the light stay. */
  | { readonly kind: "panel" }
  | { readonly kind: "command"; readonly id: string }
  /** Goes to the next reply from the agent; with none, through the notes on the page. */
  | { readonly kind: "reply" }
  /** Shows the variant `by` on: of the step's part, else of the step's own. */
  | { readonly kind: "variant"; readonly by: number }
  /** Lifts the step's part, to see its variants and states; or lists the step's variants. */
  | { readonly kind: "lift" }
  /** Starts or stops pointing at an element for a note, as Alt held does. */
  | { readonly kind: "aim"; readonly on: boolean }
  /** Goes to the journey's first or last step not settled. */
  | { readonly kind: "end"; readonly which: "first" | "last" }
  /** Selects the tree's row `by` rows on, over its notes, steps and journeys. */
  | { readonly kind: "row"; readonly by: number }
  /** Does what a click on the tree's selected row does. */
  | { readonly kind: "pick" }
  /** Settles the step selected in the tree, or opens it again. */
  | { readonly kind: "settleSelected" }
  /** In the panel's tree, as in Neovim's: `open` opens the row's children, goes down into
   * them once open, or with none, opens what the row names; else it closes them, or goes up
   * to the row it is under, or with none, to the row above. */
  | { readonly kind: "tree"; readonly open: boolean };

export type Group = "Review" | "Notes" | "Panel" | "Tools";

export interface Binding {
  /** The keys, each one key. */
  readonly keys: readonly string[];
  /** Whether the key is pressed with Ctrl, as Ctrl+R. */
  readonly ctrl?: boolean;
  readonly label: string;
  /** For two keys that go two ways, as h and l: a label for each, so the `?` menu has a row
   * for each way, and a tap does either. */
  readonly each?: readonly [string, string];
  readonly group: Group;
  /** Where the key works; "go" is the key after g, on the page and in the panel's tree. */
  readonly zone: "page" | "panel" | "go";
  /** For a key after g: works only when g came from there. */
  readonly from?: "page" | "panel";
  readonly when?: (view: View) => boolean;
  readonly does: Action | ((key: string) => Action);
}

const event = (e: Event): Action => ({ kind: "event", event: e });
const active = (v: View) => v.active;
// The preview turns the keys as the tree has them: j and k go down and up the steps, and
// h and l go across the step's variants, to compare them quickly with the page alone.
const walking = (v: View) => v.active && !v.preview;
const looking = (v: View) => v.active && v.preview;

export const BINDINGS: readonly Binding[] = [
  // The review, on the page.
  {
    keys: ["h", "l"],
    label: "Step before, after",
    each: ["Step before", "Step after"],
    group: "Review",
    zone: "page",
    when: walking,
    does: (k) => event({ type: "go", by: k === "l" ? 1 : -1 }),
  },
  {
    keys: ["j", "k"],
    label: "In the preview: step after, before",
    each: ["In the preview: step after", "In the preview: step before"],
    group: "Review",
    zone: "page",
    when: looking,
    does: (k) => event({ type: "go", by: k === "j" ? 1 : -1 }),
  },
  {
    keys: ["h", "l"],
    label: "In the preview: previous, next variant",
    each: ["In the preview: previous variant", "In the preview: next variant"],
    group: "Review",
    zone: "page",
    when: (v) => looking(v) && v.variants > 1,
    does: (k) => ({ kind: "variant", by: k === "l" ? 1 : -1 }),
  },
  {
    keys: ["H", "L"],
    label: "Open step before, after: not settled",
    each: ["Open step before: not settled", "Open step after: not settled"],
    group: "Review",
    zone: "page",
    when: active,
    does: (k) => event({ type: "go", by: k === "L" ? 1 : -1, open: true }),
  },
  {
    keys: ["j", "k"],
    label: "Next, previous variant",
    each: ["Next variant", "Previous variant"],
    group: "Review",
    zone: "page",
    when: (v) => walking(v) && v.variants > 1,
    does: (k) => ({ kind: "variant", by: k === "j" ? 1 : -1 }),
  },
  // An app with its own h, j, k and l takes them first; it leaves these to the tools.
  {
    keys: ["h", "l"],
    ctrl: true,
    label: "Previous, next variant",
    each: ["Previous variant", "Next variant"],
    group: "Review",
    zone: "page",
    when: (v) => active(v) && v.variants > 1,
    does: (k) => ({ kind: "variant", by: k === "l" ? 1 : -1 }),
  },
  {
    keys: ["v"],
    label: "Lift the part: its variants and states",
    group: "Review",
    zone: "page",
    // With nothing to lift, v says so, rather than doing nothing.
    when: active,
    does: { kind: "lift" },
  },
  {
    keys: ["0"],
    label: "Build the step's page again from the start, with its part in the middle",
    group: "Review",
    zone: "page",
    when: active,
    does: event({ type: "reset" }),
  },
  {
    keys: ["y"],
    label: "Settle the step: it is right, as it shows; then the next. Or open it again",
    group: "Review",
    zone: "page",
    when: active,
    does: event({ type: "settle" }),
  },
  {
    keys: ["Escape"],
    label: "Leave the step for the page; the walk stays where it is",
    group: "Review",
    zone: "page",
    when: walking,
    does: event({ type: "leave" }),
  },
  {
    keys: ["G"],
    label: "Go to the last open step",
    group: "Review",
    zone: "page",
    when: active,
    does: { kind: "end", which: "last" },
  },
  // Notes.
  {
    keys: ["i"],
    label: "Write a message in the panel's chat: the step's or the page's",
    group: "Notes",
    zone: "page",
    does: { kind: "focus", to: "note" },
  },
  {
    keys: ["Tab"],
    label: "On a step, write to the page instead, or to the step again",
    group: "Notes",
    zone: "page",
    when: active,
    does: event({ type: "chat" }),
  },
  {
    keys: ["R"],
    label: "Next reply; with none, the notes on the page",
    group: "Notes",
    zone: "page",
    does: { kind: "reply" },
  },
  // The panel's tree.
  {
    keys: ["j", "k"],
    label: "Select the row below, above: a note, a step or a journey",
    group: "Panel",
    zone: "panel",
    does: (k) => ({ kind: "row", by: k === "j" ? 1 : -1 }),
  },
  {
    keys: ["h", "l"],
    label: "Close the row or go up; open it or go down into it",
    group: "Panel",
    zone: "panel",
    does: (k) => ({ kind: "tree", open: k === "l" }),
  },
  {
    keys: ["j", "k"],
    ctrl: true,
    label: "Select the next step below, above that is not settled",
    group: "Panel",
    zone: "panel",
    does: (k) => event({ type: "cursorOpen", by: k === "j" ? 1 : -1 }),
  },
  {
    keys: ["y"],
    label: "Settle the selected step, or open it again; then go on to the next open one",
    group: "Panel",
    zone: "panel",
    when: active,
    does: { kind: "settleSelected" },
  },
  {
    keys: ["G"],
    label: "Select the bottom row",
    group: "Panel",
    zone: "panel",
    does: { kind: "row", by: Infinity },
  },
  {
    keys: ["Enter"],
    label: "Open the selected row",
    group: "Panel",
    zone: "panel",
    does: { kind: "pick" },
  },
  {
    keys: ["i"],
    label: "Write again in the field you left, or a message on the step",
    group: "Panel",
    zone: "panel",
    does: { kind: "focus", to: "note" },
  },
  // The tools, on the page and in the panel.
  {
    keys: ["p"],
    ctrl: true,
    label: "Hide the tools to see the page as a user does, or show them again",
    group: "Tools",
    zone: "page",
    does: event({ type: "preview" }),
  },
  {
    keys: ["b"],
    ctrl: true,
    label: "Hide the panel, or show it again",
    group: "Tools",
    zone: "page",
    does: { kind: "panel" },
  },
  // g opens the g menu; the key after g does the thing.
  {
    keys: ["g"],
    label: "More keys: g, then the key the menu shows",
    group: "Tools",
    zone: "page",
    does: event({ type: "open", layer: "go" }),
  },
  // As in vim: g g and G go to the top and the bottom, of the steps or the tree's rows.
  {
    keys: ["g"],
    label: "Go to the first open step",
    group: "Review",
    zone: "go",
    from: "page",
    when: active,
    does: { kind: "end", which: "first" },
  },
  {
    keys: ["g"],
    label: "Select the top row",
    group: "Panel",
    zone: "go",
    from: "panel",
    does: { kind: "row", by: -Infinity },
  },
  {
    keys: ["j"],
    label: "Journeys: pick one to review",
    group: "Tools",
    zone: "go",
    does: event({ type: "open", layer: "journeys" }),
  },
  {
    keys: ["p"],
    label: "This page: its chat, notes and parts",
    group: "Notes",
    zone: "go",
    does: event({ type: "open", layer: "here" }),
  },
  // Undo takes back the tools' own actions, as a removed note. In a field, vim's u and
  // Ctrl+R take back the text instead.
  { keys: ["u"], label: "Undo", group: "Tools", zone: "page", does: event({ type: "undo" }) },
  {
    keys: ["r"],
    ctrl: true,
    label: "Redo",
    group: "Tools",
    zone: "page",
    does: event({ type: "redo" }),
  },
  {
    keys: ["a"],
    label: "Act as someone",
    group: "Tools",
    zone: "go",
    when: (v) => v.people,
    does: event({ type: "open", layer: "people" }),
  },
  {
    keys: ["?"],
    label: "Keys and commands",
    group: "Tools",
    zone: "page",
    does: event({ type: "open", layer: "help" }),
  },
];

/** The app's commands with keys, as bindings on the page. */
export const commandBindings = (
  commands: readonly { readonly id: string; readonly title: string; readonly key?: string }[],
): readonly Binding[] =>
  commands.flatMap((c) =>
    c.key === undefined
      ? []
      : [
          {
            keys: [c.key],
            label: c.title,
            group: "Tools" as const,
            zone: "page" as const,
            does: { kind: "command" as const, id: c.id },
          },
        ],
  );

const keyOf = (b: Binding, key: string) => (b.ctrl === true ? `Ctrl+${key}` : key);

/**
 * The bindings that work in this zone now; "go" gives the g menu's. The tree has the focus
 * while it shows, so it has the page's keys too, but the ones it uses itself, as j and k.
 */
export const bindingsFor = (bindings: readonly Binding[], view: View, zone: Zone | "go") => {
  const usable = (b: Binding) => b.when === undefined || b.when(view);
  const own = bindings.filter((b) => b.zone === zone && usable(b));
  if (zone !== "panel") return own;
  const taken = new Set(own.flatMap((b) => b.keys.map((k) => keyOf(b, k))));
  const page = bindings.filter(
    (b) =>
      b.zone === "page" &&
      usable(b) &&
      // A key that puts the keys in the tree, where they already are.
      !(typeof b.does !== "function" && b.does.kind === "focus" && b.does.to === "panel") &&
      !b.keys.some((k) => taken.has(keyOf(b, k))),
  );
  return [...own, ...page];
};

/** The g menu's keys, after g in this zone. */
export const goBindings = (bindings: readonly Binding[], view: View, zone: Zone) =>
  bindingsFor(bindings, view, "go").filter(
    (b) => b.from === undefined || b.from === (zone === "panel" ? "panel" : "page"),
  );

/** A key as the keymap reads it. */
export interface Key {
  readonly key: string;
  readonly meta?: boolean;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
}

/** Whose element has the focus: the tools', as their fields and the panel's tree, or a field of
 * the page's; a picker of the tools' keeps every key, as Ctrl+P to move up. */
export type Owner = "tools" | "page" | "picker";

/**
 * What a key does before anything else on the page sees it: Ctrl+P hides the tools and shows
 * them again, and Ctrl+B hides the panel and shows it again, from a field too. While a step is
 * open they are the tools' alone, so the page's own Ctrl+B waits until the step closes; the
 * tools' own fields and the panel's tree have them always. With no step open, the page
 * has them first, and the page's bindings take them after. On a Mac, a field loses Ctrl+P and Ctrl+B for up a line
 * and back a letter.
 */
export function firstAction(view: View, key: Key, owner?: Owner): Action | undefined {
  // Escape stops pointing, wherever the keys are, a field and the palette too.
  if (view.aiming === true && key.key === "Escape" && !key.ctrl && !key.alt && !key.meta)
    return { kind: "aim", on: false };
  if (key.alt === true || key.ctrl !== true || key.meta === true) return undefined;
  if (owner === "picker") return undefined;
  if (!view.active && owner !== "tools") return undefined;
  if (key.key === "p") return event({ type: "preview" });
  return key.key === "b" ? { kind: "panel" } : undefined;
}

/**
 * What a key does, in this zone and view; undefined leaves it to the page. A field keeps
 * every key but Escape, which leaves it; an open list keeps every key.
 */
export function dispatch(
  bindings: readonly Binding[],
  view: View,
  zone: Zone,
  key: Key,
): Action | undefined {
  const first = firstAction(view, key, zone === "panel" ? "tools" : undefined);
  if (first !== undefined) return first;
  if (key.meta === true || key.alt === true) return undefined;
  if (zone === "list") return undefined;
  if (zone === "field")
    return key.key === "Escape" && key.ctrl !== true ? { kind: "blur" } : undefined;
  const ctrl = key.ctrl === true;
  // The g menu takes the key after g: one of its own does the thing, and any other closes it.
  if (view.layer === "go" && !ctrl) {
    const next = goBindings(bindings, view, zone).find((b) => b.keys.includes(key.key));
    if (next === undefined) return event({ type: "escape" });
    return typeof next.does === "function" ? next.does(key.key) : next.does;
  }
  // Escape backs out one level: it closes what is open over the page, then leaves the step
  // for the page, then hides the tools, so they come back as they were, the panel and the
  // note card too. In the preview it shows them again, as Ctrl+P does. Leaving moves the
  // reviewer; only Ctrl+B and Ctrl+P hide.
  if (key.key === "Escape" && view.preview && key.ctrl !== true) return event({ type: "preview" });
  if (key.key === "Escape" && key.ctrl !== true)
    return view.layer !== "none"
      ? event({ type: "escape" })
      : view.active
        ? event({ type: "leave" })
        : zone === "panel" || view.panel
          ? event({ type: "preview" })
          : undefined;
  const usable = bindingsFor(bindings, view, zone).filter((b) => (b.ctrl === true) === ctrl);
  const binding = usable.find((b) => b.keys.includes(key.key));
  if (binding === undefined) return undefined;
  return typeof binding.does === "function" ? binding.does(key.key) : binding.does;
}

/** The zone of the focused element: a field, a list, the panel's tree, or the page. */
export function zoneOf(element: Element | null): Zone {
  if (element === null) return "page";
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
    return "field";
  const zone = element.closest("[data-dt-zone]")?.getAttribute("data-dt-zone");
  if (zone === "panel" || zone === "list") return zone;
  if (element.closest("[role=dialog],[role=listbox],[role=menu]") !== null) return "list";
  return "page";
}

/** Whose element has the focus: the tools', for a field in their root and the tree, or the
 * page's, for its own field; on the page itself, nobody's. */
export function ownerOf(element: Element | null): Owner | undefined {
  if (element === null) return undefined;
  if (element.closest("[data-dt-picker]") !== null) return "picker";
  const zone = zoneOf(element);
  if (zone === "panel") return "tools";
  if (zone !== "field") return undefined;
  return element.closest(".blueline, .blueline-portal") === null ? "page" : "tools";
}

/** How the `?` menu names a binding's keys, as `Ctrl+R` or `g g`. */
export const keyName = (b: Binding, keys: readonly string[] = b.keys) =>
  keys
    .map((k) =>
      b.ctrl === true
        ? `Ctrl+${k.toUpperCase()}`
        : k === "Enter"
          ? "↵"
          : k === "Escape"
            ? "Esc"
            : k,
    )
    .map((k) => (b.zone === "go" ? `g ${k}` : k))
    .join(" ");

/** A row of the `?` menu: a binding, or one way of a binding with two, and the key a tap on
 * it presses. */
export interface HelpRow {
  readonly label: string;
  readonly key: string;
  readonly binding: Binding;
  readonly press: string;
}

/** The `?` menu's rows for the bindings: one for each, and one for each way of two. */
export const helpRows = (bindings: readonly Binding[]): readonly HelpRow[] =>
  bindings.flatMap((b): HelpRow[] => {
    if (b.each !== undefined)
      return b.each.flatMap((label, i) => {
        const press = b.keys[i];
        return press === undefined ? [] : [{ label, key: keyName(b, [press]), binding: b, press }];
      });
    const press = b.keys[0];
    return press === undefined ? [] : [{ label: b.label, key: keyName(b), binding: b, press }];
  });

/** What a tap on a row of the `?` menu does: what its key does. */
export const rowAction = (row: HelpRow): Action =>
  typeof row.binding.does === "function" ? row.binding.does(row.press) : row.binding.does;
