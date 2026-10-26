import type { Event, Layer } from "../session/machine";

/*
 * Every key of the dev tools, in one list. The dispatcher reads it to act on a key, and the
 * `?` menu reads it to show the keys that work now, so the menu never shows a key that does
 * nothing or hides one that does something.
 *
 * The keys move the way things stand on the screen, and each arrow does what its vim key
 * does. On a step the panel's foot goes across, the step before, Settle and the step after,
 * so h and l, or the left and right arrows, go to the step before and after. The variants
 * stand in a list down the panel, so j and k, or the down and up arrows, go down and up it.
 * What a key does depends on where the focus is, its zone, read from the page when the key
 * comes; in the panel's tree, j and k move the selection.
 * g opens the g menu, as LazyVim's which-key: the key after it, as j in g j, does the thing.
 *
 * No key needs AltGr or Option on a Norwegian Mac, so no [ ] { } \ | @ $ ~ or backtick.
 */

/** Where the focus is. A field and an open list (a picker, the menu) keep their keys. A
 * control of the app's, as a button, a link or a slider, has the page's keys but Enter,
 * Space and the arrows, its own. */
export type Zone = "page" | "control" | "panel" | "field" | "list";

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
  /** Whether the reviewer points at an element for a note, from m or the pin button. */
  readonly aiming?: boolean | undefined;
  /** Whether every step is settled and the panel asks the reviewer to finish the review. */
  readonly finishing?: boolean | undefined;
  /** Whether the panel shows the hand-off: the review went to the agent. */
  readonly handoff?: boolean | undefined;
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
  /** Shows the variant at `at`, from 0, in the panel's list; past its end it does nothing. */
  | { readonly kind: "variantAt"; readonly at: number }
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

export type Group = "Review" | "Chat" | "Panel" | "Tools";

export interface Binding {
  /** The keys, each as `nameOf` names a press: `h`, `ArrowLeft`, `Shift+ArrowLeft`, ` ` for
   * Space, `Ctrl+r`, `Cmd+z`, and `Ctrl+Z` with Shift. Each does the same thing. */
  readonly keys: readonly string[];
  readonly label: string;
  /** How the `?` menu writes the keys, as `1-9`, when it does not list each one. */
  readonly shows?: string;
  readonly group: Group;
  /** Whether a held key does it once: its repeats do nothing, so a held y never settles a
   * step the reviewer has not seen. */
  readonly once?: boolean;
  /** Where the key works; "go" is the key after g, on the page and in the panel's tree. */
  readonly zone: "page" | "panel" | "go";
  /** For a key after g: works only when g came from there. */
  readonly from?: "page" | "panel";
  readonly when?: (view: View) => boolean;
  readonly does: Action | ((key: string) => Action);
}

const event = (e: Event): Action => ({ kind: "event", event: e });
// While the panel asks to finish the review, the walk waits: Enter finishes, and Escape and
// u go back.
const active = (v: View) => v.active && v.finishing !== true;
const walking = (v: View) => active(v) && !v.preview;
const varied = (v: View) => active(v) && v.variants > 1;

export const BINDINGS: readonly Binding[] = [
  // The review, on the page. The keys go as the panel stands: across its foot to the step
  // before and after, and down its list of variants. The preview keeps the same keys.
  {
    keys: ["h", "ArrowLeft"],
    label: "Step before",
    group: "Review",
    zone: "page",
    when: active,
    does: event({ type: "go", by: -1 }),
  },
  {
    keys: ["l", "ArrowRight"],
    label: "Step after",
    group: "Review",
    zone: "page",
    when: active,
    does: event({ type: "go", by: 1 }),
  },
  {
    keys: ["j", "ArrowDown"],
    label: "Next variant",
    group: "Review",
    zone: "page",
    when: varied,
    does: { kind: "variant", by: 1 },
  },
  {
    keys: ["k", "ArrowUp"],
    label: "Previous variant",
    group: "Review",
    zone: "page",
    when: varied,
    does: { kind: "variant", by: -1 },
  },
  {
    keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    shows: "1-9",
    label: "Show the variant with that number",
    group: "Review",
    zone: "page",
    when: varied,
    does: (k) => ({ kind: "variantAt", at: Number(k) - 1 }),
  },
  {
    keys: ["H", "Shift+ArrowLeft"],
    label: "Open step before: not settled",
    group: "Review",
    zone: "page",
    when: active,
    does: event({ type: "go", by: -1, open: true }),
  },
  {
    keys: ["L", "Shift+ArrowRight"],
    label: "Open step after: not settled",
    group: "Review",
    zone: "page",
    when: active,
    does: event({ type: "go", by: 1, open: true }),
  },
  {
    keys: ["v", " "],
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
    // Enter is a control's own key: on the app's button, link or field it is the app's
    // (zoneOf gives "control"), so a press there still clicks.
    keys: ["y", "Enter"],
    label: "Settle the step: it is right as it shows; then the next open one",
    group: "Review",
    zone: "page",
    once: true,
    when: (v) => active(v) && v.layer === "none",
    does: event({ type: "settle" }),
  },
  {
    keys: ["Enter"],
    label: "Finish the review: send it to the agent",
    group: "Review",
    zone: "page",
    once: true,
    when: (v) => v.active && v.finishing === true && v.layer === "none",
    does: event({ type: "finish" }),
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
  // Chat.
  {
    keys: ["i"],
    label: "Write a message in the panel's chat: the step's or the page's",
    group: "Chat",
    zone: "page",
    does: { kind: "focus", to: "note" },
  },
  {
    keys: ["m"],
    label: "Annotate: then click the element it is about",
    group: "Chat",
    zone: "page",
    does: { kind: "aim", on: true },
  },
  {
    keys: ["Tab"],
    label: "On a step, write to the page instead, or to the step again",
    group: "Chat",
    zone: "page",
    when: active,
    does: event({ type: "chat" }),
  },
  {
    keys: ["R"],
    label: "Next reply; with none, the annotations on the page",
    group: "Chat",
    zone: "page",
    does: { kind: "reply" },
  },
  // The panel's tree.
  {
    keys: ["j"],
    label: "Select the row below: an annotation, a step or a journey",
    group: "Panel",
    zone: "panel",
    does: { kind: "row", by: 1 },
  },
  {
    keys: ["k"],
    label: "Select the row above",
    group: "Panel",
    zone: "panel",
    does: { kind: "row", by: -1 },
  },
  {
    keys: ["h"],
    label: "Close the row, or go up",
    group: "Panel",
    zone: "panel",
    does: { kind: "tree", open: false },
  },
  {
    keys: ["l"],
    label: "Open the row, or go down into it",
    group: "Panel",
    zone: "panel",
    does: { kind: "tree", open: true },
  },
  {
    keys: ["Ctrl+j"],
    label: "Select the next step below that is not settled",
    group: "Panel",
    zone: "panel",
    does: event({ type: "cursorOpen", by: 1 }),
  },
  {
    keys: ["Ctrl+k"],
    label: "Select the next step above that is not settled",
    group: "Panel",
    zone: "panel",
    does: event({ type: "cursorOpen", by: -1 }),
  },
  {
    keys: ["y"],
    label: "Settle the selected step and go on to the next open one, or open a settled one again",
    group: "Panel",
    zone: "panel",
    once: true,
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
  // The tools, on the page and in the panel. A tap of p hides the tools, and another shows
  // them; p held shows the page only while it is down (holdToggle).
  {
    keys: ["p"],
    label: "Preview: hide the tools but the eye, or show them again. Hold p to peek",
    group: "Tools",
    zone: "page",
    once: true,
    does: event({ type: "preview" }),
  },
  {
    keys: ["Ctrl+b"],
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
    label: "This page: its chat, annotations and parts",
    group: "Chat",
    zone: "go",
    does: event({ type: "open", layer: "here" }),
  },
  // Undo takes back the tools' own actions, as a removed note. In a field, vim's u and
  // Ctrl+R, and the field's own Cmd+Z, take back the text instead.
  {
    keys: ["u", "Ctrl+z", "Cmd+z"],
    label: "Undo",
    group: "Tools",
    zone: "page",
    when: (v) => v.finishing !== true,
    does: event({ type: "undo" }),
  },
  {
    keys: ["u", "Ctrl+z", "Cmd+z"],
    label: "Back: open the last step again",
    group: "Review",
    zone: "page",
    when: (v) => v.finishing === true,
    does: event({ type: "back" }),
  },
  {
    keys: ["Ctrl+r", "Ctrl+Z", "Cmd+Z"],
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

/** The keys a control of the app's keeps, as a button's Enter and Space, and a slider's or a
 * list's arrows, so a press there does what the app says. */
const ownKey = (key: string) => key === "Enter" || key === " " || key.includes("Arrow");

/**
 * The bindings that work in this zone now; "go" gives the g menu's. The tree has the focus
 * while it shows, so it has the page's keys too, but the ones it uses itself, as j and k.
 */
export const bindingsFor = (
  bindings: readonly Binding[],
  view: View,
  zone: Zone | "go",
): readonly Binding[] => {
  // A control of the app's keeps its own keys, so a press on it does what the app says.
  if (zone === "control")
    return bindingsFor(bindings, view, "page").flatMap((b) => {
      const keys = b.keys.filter((k) => !ownKey(k));
      return keys.length === 0 ? [] : [keys.length === b.keys.length ? b : { ...b, keys }];
    });
  const usable = (b: Binding) => b.when === undefined || b.when(view);
  const own = bindings.filter((b) => b.zone === zone && usable(b));
  if (zone !== "panel") return own;
  const taken = new Set(own.flatMap((b) => b.keys));
  const page = bindings.filter(
    (b) =>
      b.zone === "page" &&
      usable(b) &&
      // A key that puts the keys in the tree, where they already are.
      !(typeof b.does !== "function" && b.does.kind === "focus" && b.does.to === "panel") &&
      // A binding the tree takes a key of, as h, goes whole, its arrow too: the tree's
      // arrows scroll it, as in a list.
      !b.keys.some((k) => taken.has(k)),
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
  readonly shift?: boolean;
  /** Whether the key is held, and this is its repeat. */
  readonly repeat?: boolean;
}

/**
 * How the bindings name a press: the key as it types, as `H` with Shift; an arrow with Shift
 * as `Shift+ArrowLeft`; and a letter with Ctrl or Cmd as `Ctrl+r` or `Cmd+z`, upper case with
 * Shift, as `Ctrl+Z`. A press with Alt, or with Ctrl and Cmd both, has no name: no binding
 * takes it. Shift on another key types its own character, as `?`, so it adds nothing.
 */
export function nameOf(key: Key): string | undefined {
  const ctrl = key.ctrl === true;
  const meta = key.meta === true;
  if (key.alt === true || (ctrl && meta)) return undefined;
  const shift = key.shift === true;
  if (ctrl || meta) {
    const mod = ctrl ? "Ctrl+" : "Cmd+";
    if (!/^[a-z]$/i.test(key.key)) return `${mod}${key.key}`;
    return `${mod}${shift ? key.key.toUpperCase() : key.key.toLowerCase()}`;
  }
  if (shift && key.key.startsWith("Arrow")) return `Shift+${key.key}`;
  return key.key;
}

/** Whose element has the focus: the tools', as their fields and the panel's tree, or a field of
 * the page's; a picker of the tools' keeps every key, as Ctrl+B. */
export type Owner = "tools" | "page" | "picker";

/**
 * What a key does before anything else on the page sees it: Ctrl+B hides the panel and shows
 * it again, from a field too. While a step is open it is the tools' alone, so the page's own
 * Ctrl+B waits until the step closes; the tools' own fields and the panel's tree have it
 * always. With no step open, the page has it first, and the page's bindings take it after.
 * On a Mac, a field loses Ctrl+B for back a letter.
 */
export function firstAction(view: View, key: Key, owner?: Owner): Action | undefined {
  // Escape stops pointing, wherever the keys are, a field and the palette too.
  if (view.aiming === true && key.key === "Escape" && !key.ctrl && !key.alt && !key.meta)
    return { kind: "aim", on: false };
  if (nameOf(key) !== "Ctrl+b") return undefined;
  if (owner === "picker") return undefined;
  if (!view.active && owner !== "tools") return undefined;
  return { kind: "panel" };
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
  const name = nameOf(key);
  if (name === undefined) return undefined;
  if (zone === "list") return undefined;
  // Escape alone: with Shift too, but no Ctrl or Cmd.
  const escape = name === "Escape";
  if (zone === "field") return escape ? { kind: "blur" } : undefined;
  const plain = !name.startsWith("Ctrl+") && !name.startsWith("Cmd+");
  // The g menu takes the key after g: one of its own does the thing, and any other closes it.
  if (view.layer === "go" && plain) {
    const next = goBindings(bindings, view, zone).find((b) => b.keys.includes(name));
    if (next === undefined) return event({ type: "escape" });
    return typeof next.does === "function" ? next.does(name) : next.does;
  }
  // Escape backs out one level: it closes what is open over the page, then leaves the step
  // for the page, then hides the tools, so they come back as they were, the panel and the
  // note card too. In the preview it shows them again, as p does. Leaving moves the
  // reviewer; only Ctrl+B and p hide.
  if (escape && view.preview) return event({ type: "preview" });
  // Escape goes back from the finish, as Back and u do: the last step opens again.
  if (escape && view.finishing === true && view.layer === "none") return event({ type: "back" });
  // Escape leaves the hand-off for the tree, as Done does.
  if (escape && view.handoff === true && view.panel && view.layer === "none")
    return event({ type: "handoff", id: null });
  if (escape)
    return view.layer !== "none"
      ? event({ type: "escape" })
      : view.active
        ? event({ type: "leave" })
        : zone === "panel" || view.panel
          ? event({ type: "preview" })
          : undefined;
  const binding = bindingsFor(bindings, view, zone).find((b) => b.keys.includes(name));
  if (binding === undefined || (binding.once === true && key.repeat === true)) return undefined;
  return typeof binding.does === "function" ? binding.does(name) : binding.does;
}

/** What uses the arrows itself, as a slider, tabs or a grid: on the page, the arrows and Space
 * there stay the app's. A list and a menu are their own zone. */
const ARROWS = [
  "slider",
  "spinbutton",
  "scrollbar",
  "tablist",
  "tab",
  "radiogroup",
  "radio",
  "grid",
  "treegrid",
  "tree",
  "toolbar",
  "menubar",
  "combobox",
]
  .map((role) => `[role=${role}]`)
  .concat("audio", "video")
  .join(",");

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
  return isControl(element) ? "control" : "page";
}

/** What takes Enter itself: a button, a link, a field, or an element that Tab goes to by its
 * own tabindex. A negative tabindex is not one: a router puts it on `main` to move the focus
 * there, and Enter on `main` presses nothing. */
const CONTROL =
  'button, a[href], area[href], input, select, textarea, summary, [contenteditable], [tabindex]:not([tabindex^="-"])';

/** Whether the focused element is a control that Enter presses: any of the app's, and one
 * in a part that uses the arrows; of the tools', one the keyboard went to, as Tab does, and
 * not one a click left the focus on. */
function isControl(element: Element): boolean {
  const own = element.closest(".blueline, .blueline-portal") !== null;
  if (!own && element.closest(ARROWS) !== null) return true;
  if (!element.matches(CONTROL)) return false;
  if (!own) return true;
  return element.matches(":focus-visible");
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

const GLYPHS: Readonly<Record<string, string>> = {
  Enter: "↵",
  Escape: "Esc",
  " ": "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

/** How the `?` menu writes one key, as `Ctrl+R`, `Cmd+Shift+Z`, `Shift+←` or `Space`. */
const written = (key: string): string => {
  const plus = key.lastIndexOf("+");
  if (plus <= 0) return GLYPHS[key] ?? key;
  const mod = key.slice(0, plus);
  const k = key.slice(plus + 1);
  if (mod === "Shift") return `Shift+${GLYPHS[k] ?? k}`;
  // A capital after Ctrl or Cmd is the letter with Shift.
  const shifted = /^[A-Z]$/.test(k);
  return `${mod}+${shifted ? "Shift+" : ""}${k.toUpperCase()}`;
};

/** The keys of a pin's note card, which its field takes (ui/composer.tsx); the `?` menu
 * lists them. */
export const CARD_KEYS = [
  { id: "send", label: "In an annotation: send it now", key: "↵" },
  { id: "later", label: "In an annotation: keep it for the next message", key: "Cmd+↵ Ctrl+↵" },
] as const;

/** How the `?` menu names a binding's keys, as `h ←`, `Ctrl+R` or `g g`. */
export const keyName = (b: Binding) =>
  b.shows ?? b.keys.map((k) => (b.zone === "go" ? `g ${written(k)}` : written(k))).join(" ");

/** A row of the `?` menu: a binding, and the key a tap on it presses. */
export interface HelpRow {
  readonly label: string;
  readonly key: string;
  readonly binding: Binding;
  readonly press: string;
}

/** The `?` menu's rows for the bindings: one for each. */
export const helpRows = (bindings: readonly Binding[]): readonly HelpRow[] =>
  bindings.flatMap((b): HelpRow[] => {
    const press = b.keys[0];
    return press === undefined ? [] : [{ label: b.label, key: keyName(b), binding: b, press }];
  });

/** What a tap on a row of the `?` menu does: what its first key does. */
export const rowAction = (row: HelpRow): Action =>
  typeof row.binding.does === "function" ? row.binding.does(row.press) : row.binding.does;
