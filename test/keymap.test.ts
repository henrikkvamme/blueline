import { describe, expect, it } from "vitest";
import { holdToggle } from "../src/keys/hold";
import {
  BINDINGS,
  bindingsFor,
  commandBindings,
  dispatch,
  firstAction,
  helpRows,
  keyName,
  nameOf,
  rowAction,
  type Key,
  type View,
  type Zone,
} from "../src/keys/keymap";
import { LAYERS } from "../src/session/machine";

const bindings = [
  ...BINDINGS,
  ...commandBindings([{ id: "copy", title: "Copy the link", key: "q" }]),
];

/** Every view the keys can meet, but with the g menu open, which takes every key: its own test
 * is below. */
const VIEWS: readonly View[] = LAYERS.filter((l) => l !== "go").flatMap((layer) =>
  [true, false].flatMap((active) =>
    [true, false].flatMap((panel) =>
      [1, 3].flatMap((variants) =>
        [true, false].flatMap((people) =>
          [true, false].map((preview) => ({
            layer,
            active,
            panel,
            variants,
            people,
            preview,
          })),
        ),
      ),
    ),
  ),
);
const ZONES: readonly Zone[] = ["page", "control", "panel", "field", "list"];
const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
const KEYS = [
  ..."abcdefghijklmnopqrstuvwxyzHJKLSY*0123456789?".split(""),
  "Enter",
  "Escape",
  " ",
  "Tab",
  ...ARROWS,
];

/** The press a binding's key names, as `Ctrl+Z` is z with Ctrl and Shift. */
const pressOf = (name: string): Key => {
  const [mod, key] = name.includes("+", 1) ? name.split("+") : [undefined, name];
  if (key === undefined) return { key: name };
  const shift = /^[A-Z]$/.test(key) || mod === "Shift";
  return { key, shift, ctrl: mod === "Ctrl", meta: mod === "Cmd" };
};

const press = (view: View, zone: Zone, key: string, more: Omit<Key, "key"> = {}) =>
  dispatch(bindings, view, zone, { key, ...more });

const go = (by: number, open?: boolean) => ({
  kind: "event",
  event: { type: "go", by, ...(open === undefined ? {} : { open }) },
});
const variant = (by: number) => ({ kind: "variant", by });
const undo = { kind: "event", event: { type: "undo" } };
const redo = { kind: "event", event: { type: "redo" } };
const preview = { kind: "event", event: { type: "preview" } };
/** The views on a step with no layer open. */
const ON_STEP = VIEWS.filter((v) => v.active && v.layer === "none");

describe("the keys", () => {
  it("name a press as the bindings do", () => {
    expect(nameOf({ key: "h" })).toBe("h");
    expect(nameOf({ key: "H", shift: true })).toBe("H");
    expect(nameOf({ key: "?", shift: true })).toBe("?");
    expect(nameOf({ key: "ArrowLeft", shift: true })).toBe("Shift+ArrowLeft");
    expect(nameOf({ key: "Enter", shift: true })).toBe("Enter");
    expect(nameOf({ key: "r", ctrl: true })).toBe("Ctrl+r");
    // Shift with Ctrl or Cmd is the capital, whichever case the browser gives.
    expect(nameOf({ key: "Z", ctrl: true, shift: true })).toBe("Ctrl+Z");
    expect(nameOf({ key: "z", meta: true, shift: true })).toBe("Cmd+Z");
    expect(nameOf({ key: "z", meta: true })).toBe("Cmd+z");
    expect(nameOf({ key: "h", alt: true })).toBeUndefined();
    expect(nameOf({ key: "z", ctrl: true, meta: true })).toBeUndefined();
  });

  it("need no AltGr or Option on a Norwegian Mac", () => {
    const awkward = /[[\]{}\\|@$~`]/;
    for (const b of BINDINGS) for (const k of b.keys) expect(awkward.test(k), k).toBe(false);
  });

  it("let a tap on the ? menu do what each key of the row does", () => {
    for (const view of VIEWS) {
      const listed = [
        ...bindingsFor(bindings, { ...view, layer: "none" }, "page"),
        ...bindingsFor(bindings, { ...view, layer: "none" }, "go"),
      ];
      const rows = helpRows(listed);
      expect(rows.length).toBe(listed.length);
      for (const row of rows) {
        const b = row.binding;
        const tapped = JSON.stringify(rowAction(row));
        // A row for a range of keys, as 1-9, taps its first.
        const keys = b.shows === undefined ? b.keys : b.keys.slice(0, 1);
        for (const k of keys)
          expect(JSON.stringify(typeof b.does === "function" ? b.does(k) : b.does)).toBe(tapped);
      }
    }
  });

  it("write the keys in the ? menu as they are pressed", () => {
    const named = (label: string) => {
      const b = BINDINGS.find((x) => x.label === label);
      if (b === undefined) throw new Error(label);
      return keyName(b);
    };
    expect(named("Step before")).toBe("h ←");
    expect(named("Next variant")).toBe("j ↓");
    expect(named("Show the variant with that number")).toBe("1-9");
    expect(named("Open step after: not settled")).toBe("L Shift+→");
    expect(named("Lift the part: its variants and states")).toBe("v Space");
    expect(named("Undo")).toBe("u Ctrl+Z Cmd+Z");
    expect(named("Redo")).toBe("Ctrl+R Ctrl+Shift+Z Cmd+Shift+Z");
    expect(named("Hide the panel, or show it again")).toBe("Ctrl+B");
  });

  it("stop pointing with Escape in every zone, before what is open closes", () => {
    for (const view of VIEWS)
      for (const zone of ZONES) {
        const aiming = { ...view, aiming: true };
        expect(press(aiming, zone, "Escape")).toEqual({ kind: "aim", on: false });
        // Every other key does as it does while not pointing.
        for (const key of KEYS.filter((k) => k !== "Escape"))
          expect(press(aiming, zone, key)).toEqual(press(view, zone, key));
      }
  });

  it("stop pointing with Escape before the page, a field or a picker sees it", () => {
    for (const view of VIEWS)
      for (const owner of ["tools", "page", "picker", undefined] as const) {
        expect(firstAction({ ...view, aiming: true }, { key: "Escape" }, owner)).toEqual({
          kind: "aim",
          on: false,
        });
        expect(firstAction(view, { key: "Escape" }, owner)).toBeUndefined();
      }
  });

  it("leave every key but Escape to a field, and every key to an open list", () => {
    for (const view of VIEWS)
      for (const key of KEYS) {
        expect(press(view, "list", key)).toBeUndefined();
        expect(press(view, "field", key)).toEqual(key === "Escape" ? { kind: "blur" } : undefined);
        // A field keeps its own undo and redo.
        for (const more of [{ meta: true }, { ctrl: true }, { meta: true, shift: true }])
          expect(press(view, "field", "z", more)).toBeUndefined();
      }
  });

  it("leave keys with Cmd, Ctrl or Alt to the page, but undo, redo, Ctrl+B and the tree's", () => {
    for (const view of VIEWS)
      for (const zone of ZONES)
        for (const key of KEYS) {
          const tools = zone === "page" || zone === "control" || zone === "panel";
          // With no Shift, Ctrl+J is j, whichever case the browser gives.
          const letter = key.length === 1 ? key.toLowerCase() : key;
          if (!(tools && letter === "z"))
            expect(press(view, zone, key, { meta: true })).toBeUndefined();
          const ctrl = [
            ...(tools ? ["r", "b", "z"] : []),
            ...(view.active ? ["b"] : []),
            ...(zone === "panel" ? ["j", "k"] : []),
          ];
          if (!ctrl.includes(letter))
            expect(press(view, zone, key, { ctrl: true })).toBeUndefined();
          expect(press(view, zone, key, { alt: true })).toBeUndefined();
        }
  });

  it("undo with u, Ctrl+Z and Cmd+Z, and redo with Ctrl+R, Ctrl+Shift+Z and Cmd+Shift+Z", () => {
    for (const view of VIEWS)
      for (const zone of ["page", "control", "panel"] as const) {
        expect(press(view, zone, "u")).toEqual(undo);
        expect(press(view, zone, "z", { ctrl: true })).toEqual(undo);
        expect(press(view, zone, "z", { meta: true })).toEqual(undo);
        expect(press(view, zone, "r", { ctrl: true })).toEqual(redo);
        expect(press(view, zone, "Z", { ctrl: true, shift: true })).toEqual(redo);
        expect(press(view, zone, "z", { meta: true, shift: true })).toEqual(redo);
        expect(press(view, zone, "Z", { meta: true, shift: true })).toEqual(redo);
      }
  });

  it("go across to the step before and after with h and l, and the left and right arrows", () => {
    for (const view of ON_STEP) {
      for (const zone of ["page", "control"] as const) {
        expect(press(view, zone, "h")).toEqual(go(-1));
        expect(press(view, zone, "l")).toEqual(go(1));
      }
      expect(press(view, "page", "ArrowLeft")).toEqual(go(-1));
      expect(press(view, "page", "ArrowRight")).toEqual(go(1));
    }
  });

  it("go down and up the panel's variants with j and k, and the down and up arrows", () => {
    for (const view of ON_STEP) {
      const many = view.variants > 1;
      for (const zone of ["page", "control"] as const) {
        expect(press(view, zone, "j")).toEqual(many ? variant(1) : undefined);
        expect(press(view, zone, "k")).toEqual(many ? variant(-1) : undefined);
      }
      expect(press(view, "page", "ArrowDown")).toEqual(many ? variant(1) : undefined);
      expect(press(view, "page", "ArrowUp")).toEqual(many ? variant(-1) : undefined);
    }
  });

  it("show a variant by its number, 1 to 9", () => {
    for (const view of ON_STEP) {
      for (let n = 1; n <= 9; n++)
        expect(press(view, "page", String(n))).toEqual(
          view.variants > 1 ? { kind: "variantAt", at: n - 1 } : undefined,
        );
      // 0 builds the step's page again.
      expect(press(view, "page", "0")).toEqual({ kind: "event", event: { type: "reset" } });
    }
  });

  it("go to the open step before and after with H and L, and Shift with the arrows", () => {
    for (const view of ON_STEP) {
      expect(press(view, "page", "H", { shift: true })).toEqual(go(-1, true));
      expect(press(view, "page", "L", { shift: true })).toEqual(go(1, true));
      expect(press(view, "page", "ArrowLeft", { shift: true })).toEqual(go(-1, true));
      expect(press(view, "page", "ArrowRight", { shift: true })).toEqual(go(1, true));
      // Shift with up and down does nothing of the tools'.
      expect(press(view, "page", "ArrowUp", { shift: true })).toBeUndefined();
    }
  });

  it("lift the part with v and Space, or say there is nothing to lift", () => {
    for (const view of VIEWS.filter((v) => v.layer === "none")) {
      expect(press(view, "page", "v")).toEqual(view.active ? { kind: "lift" } : undefined);
      expect(press(view, "page", " ")).toEqual(view.active ? { kind: "lift" } : undefined);
    }
  });

  it("leave the arrows and Space to a control of the app's, as a slider or a button", () => {
    for (const view of VIEWS)
      for (const key of [...ARROWS, " ", "Enter"]) {
        expect(press(view, "control", key)).toBeUndefined();
        expect(press(view, "control", key, { shift: true })).toBeUndefined();
      }
  });

  it("leave the arrows, Space and the walk's keys to the page off a step, so it scrolls", () => {
    for (const view of VIEWS.filter((v) => !v.active))
      for (const zone of ["page", "control", "panel"] as const)
        for (const key of [...ARROWS, " ", "H", "L", "y", "v", "1", "3"]) {
          expect(press(view, zone, key)).toBeUndefined();
          expect(press(view, zone, key, { shift: true })).toBeUndefined();
        }
    for (const view of VIEWS.filter((v) => !v.active))
      for (const zone of ["page", "control"] as const)
        for (const key of ["h", "j", "k", "l"]) expect(press(view, zone, key)).toBeUndefined();
  });

  it("leave the arrows to the tree, which keeps its own keys", () => {
    for (const view of VIEWS.filter((v) => v.layer === "none"))
      for (const key of ARROWS) expect(press(view, "panel", key)).toBeUndefined();
  });

  it("do nothing with the keys that went: J, K, Ctrl+P, and Ctrl+H, J, K and L on the page", () => {
    for (const view of VIEWS)
      for (const zone of ["page", "control"] as const) {
        expect(press(view, zone, "J", { shift: true })).toBeUndefined();
        expect(press(view, zone, "K", { shift: true })).toBeUndefined();
        for (const key of ["p", "h", "j", "k", "l"])
          expect(press(view, zone, key, { ctrl: true }), key).toBeUndefined();
      }
    for (const view of VIEWS) {
      expect(press(view, "panel", "p", { ctrl: true })).toBeUndefined();
      for (const owner of ["tools", "page", undefined] as const)
        expect(firstAction(view, { key: "p", ctrl: true }, owner)).toBeUndefined();
    }
  });

  it("point at an element for a note with m", () => {
    for (const view of VIEWS.filter((v) => v.layer === "none" && v.finishing !== true))
      expect(press(view, "page", "m")).toEqual({ kind: "aim", on: true });
  });

  it("preview with p, from the page and the tree, but not after g, where p is this page", () => {
    for (const view of VIEWS.filter((v) => v.layer === "none"))
      for (const zone of ["page", "control", "panel"] as const) {
        expect(press(view, zone, "p")).toEqual(preview);
        // A held p does it once; its release decides the rest (holdToggle).
        expect(press(view, zone, "p", { repeat: true })).toBeUndefined();
        expect(press({ ...view, layer: "go" }, zone, "p")).toEqual({
          kind: "event",
          event: { type: "open", layer: "here" },
        });
      }
  });

  it("show the tools again on the release of a held p, and keep them hidden after a tap", () => {
    const p = holdToggle(200);
    p.down(0);
    expect(p.up(120)).toBe(false);
    p.down(1000);
    // A repeat is no new press.
    p.down(1100);
    expect(p.up(1250)).toBe(true);
    // A release with no press does nothing.
    expect(p.up(2000)).toBe(false);
  });

  it("give each key at most one meaning in a zone", () => {
    for (const view of VIEWS)
      for (const zone of ZONES) {
        const keys = bindingsFor(bindings, view, zone).flatMap((b) => b.keys);
        expect(new Set(keys).size, `${zone} ${JSON.stringify(view)}`).toBe(keys.length);
      }
  });

  it("do what the ? menu says, for every key it shows", () => {
    for (const view of VIEWS)
      for (const zone of ZONES)
        for (const binding of bindingsFor(bindings, view, zone))
          for (const key of binding.keys) {
            const does = typeof binding.does === "function" ? binding.does(key) : binding.does;
            expect(dispatch(bindings, view, zone, pressOf(key))).toEqual(
              key === "Escape" && (zone === "page" || zone === "control" || view.layer !== "none")
                ? expect.anything()
                : does,
            );
          }
  });

  it("show in the ? menu every key that does something", () => {
    for (const view of VIEWS)
      for (const zone of ["page", "panel"] as const)
        for (const key of KEYS) {
          if (key === "Escape") continue;
          const does = press(view, zone, key);
          if (does === undefined) continue;
          const shown = bindingsFor(bindings, view, zone).some((b) => b.keys.includes(key));
          expect(shown, `${key} in ${zone}`).toBe(true);
        }
  });

  it("give one key to each thing: y settles and goes on, 0 builds the step again", () => {
    for (const view of ON_STEP) {
      expect(press(view, "page", "y")).toEqual({ kind: "event", event: { type: "settle" } });
      for (const key of ["Y", "n", "N", "s"]) expect(press(view, "page", key), key).toBeUndefined();
      // Tab writes to the page's chat or the step's again.
      expect(press(view, "page", "Tab")).toEqual({ kind: "event", event: { type: "chat" } });
    }
  });

  it("keep Ctrl+J and Ctrl+K for the tree's open steps", () => {
    for (const view of ON_STEP) {
      expect(press(view, "panel", "j", { ctrl: true })).toEqual({
        kind: "event",
        event: { type: "cursorOpen", by: 1 },
      });
      expect(press(view, "panel", "k", { ctrl: true })).toEqual({
        kind: "event",
        event: { type: "cursorOpen", by: -1 },
      });
    }
  });

  it("settle with Enter as with y, on the page with no layer open, and leave Enter to the app's control", () => {
    const settle = { kind: "event", event: { type: "settle" } };
    for (const view of VIEWS) {
      const enter = (zone: Zone) => press(view, zone, "Enter");
      expect(enter("page")).toEqual(view.active && view.layer === "none" ? settle : undefined);
      // A focused button, link or field of the app's keeps Enter, so it still clicks.
      expect(enter("control")).toBeUndefined();
      expect(enter("field")).toBeUndefined();
      // The tree keeps its own Enter.
      if (view.layer === "none") expect(enter("panel")).toEqual({ kind: "pick" });
      // y settles from a control of the app's too: it is no key of a control.
      if (view.active && view.layer === "none") expect(press(view, "control", "y")).toEqual(settle);
    }
  });

  it("finish with Enter, and go back with Escape, u or Ctrl+Z, while the finish asks", () => {
    const finish = { kind: "event", event: { type: "finish" } };
    const back = { kind: "event", event: { type: "back" } };
    for (const view of ON_STEP) {
      const asks = { ...view, finishing: true };
      const keys = (key: string, more: Omit<Key, "key"> = {}) => press(asks, "page", key, more);
      expect(keys("Enter")).toEqual(finish);
      // The Enter that settled the last step, held, does not finish too.
      expect(keys("Enter", { repeat: true })).toBeUndefined();
      expect(keys("Escape")).toEqual(view.preview ? expect.anything() : back);
      expect(keys("u")).toEqual(back);
      expect(keys("z", { meta: true })).toEqual(back);
      // The walk waits: no step, variant or settle.
      for (const key of ["j", "k", "h", "l", "H", "L", "y", "v", " ", "0", "1", ...ARROWS])
        expect(keys(key), key).toBeUndefined();
      // The app's own control keeps Enter.
      expect(press(asks, "control", "Enter")).toBeUndefined();
      expect(press(view, "page", "Enter")).not.toEqual(finish);
    }
  });

  it("settle once for a held key: the key's repeats do nothing", () => {
    for (const view of ON_STEP) {
      for (const zone of ["page", "control", "panel"] as const)
        expect(press(view, zone, "y", { repeat: true })).toBeUndefined();
      expect(press(view, "page", "Enter", { repeat: true })).toBeUndefined();
      // A held l still walks on, as it settles nothing.
      expect(press(view, "page", "l", { repeat: true })).toEqual(go(1));
    }
  });

  it("hide and show the panel with Ctrl+B, from every zone in a review", () => {
    for (const view of VIEWS)
      for (const zone of ZONES)
        // With no review on, Ctrl+B hides or shows the panel from the page, after the page's
        // own keys, and from the tree.
        expect(press(view, zone, "b", { ctrl: true })).toEqual(
          view.active || zone === "page" || zone === "control" || zone === "panel"
            ? { kind: "panel" }
            : undefined,
        );
  });

  it("take Ctrl+B before the page only while the review is on", () => {
    for (const view of VIEWS) {
      const first = (key: string, more: Omit<Key, "key">) => firstAction(view, { key, ...more });
      expect(first("b", { ctrl: true })).toEqual(view.active ? { kind: "panel" } : undefined);
      // The page keeps Cmd+B, Ctrl+K and plain letters.
      expect(first("b", { meta: true })).toBeUndefined();
      expect(first("k", { ctrl: true })).toBeUndefined();
      expect(first("b", {})).toBeUndefined();
    }
  });

  it("hide and show the panel with Ctrl+B from a field too, as from the page", () => {
    for (const view of VIEWS) {
      const b = (field: "tools" | "page") => firstAction(view, { key: "b", ctrl: true }, field);
      // The tools' own fields have Ctrl+B always; the page's fields only in a review.
      expect(b("tools")).toEqual({ kind: "panel" });
      expect(b("page")).toEqual(view.active ? { kind: "panel" } : undefined);
      expect(firstAction(view, { key: "b", ctrl: true, alt: true }, "tools")).toBeUndefined();
    }
  });

  it("leave Ctrl+P, Ctrl+N and Ctrl+B to a picker, which moves with them", () => {
    for (const view of VIEWS)
      for (const key of ["p", "n", "b"])
        expect(firstAction(view, { key, ctrl: true }, "picker")).toBeUndefined();
  });

  it("back out one level with Escape: what is open, the step, then the tools, which it shows again", () => {
    const leave = { kind: "event", event: { type: "leave" } };
    for (const view of VIEWS) {
      // The preview ends as p ends it: the tools come back as they were.
      expect(press(view, "page", "Escape")).toEqual(
        view.preview
          ? preview
          : view.layer !== "none"
            ? { kind: "event", event: { type: "escape" } }
            : view.active
              ? leave
              : view.panel
                ? preview
                : undefined,
      );
      // In the tree, Escape off a step hides the tools rather than the panel, so they come
      // back as they were.
      expect(press(view, "panel", "Escape")).toEqual(
        view.preview
          ? preview
          : view.layer !== "none"
            ? { kind: "event", event: { type: "escape" } }
            : view.active
              ? leave
              : preview,
      );
    }
  });

  it("leave a step with Escape and never hide the panel with it: only Ctrl+B does", () => {
    for (const view of VIEWS.filter((v) => v.active && !v.preview && v.layer === "none"))
      for (const zone of ["page", "panel"] as const)
        expect(press(view, zone, "Escape")).toEqual({ kind: "event", event: { type: "leave" } });
    for (const view of VIEWS)
      for (const zone of ZONES)
        for (const key of KEYS) expect(press(view, zone, key)).not.toEqual({ kind: "panel" });
  });

  it("open the g menu with g, on the page and in the tree", () => {
    for (const view of VIEWS.filter((v) => v.layer === "none"))
      for (const zone of ["page", "panel"] as const)
        expect(press(view, zone, "g")).toEqual({
          kind: "event",
          event: { type: "open", layer: "go" },
        });
    // a is the g menu's alone, so the page keeps the plain key.
    for (const view of VIEWS.filter((v) => v.layer === "none"))
      expect(press(view, "page", "a")).toBeUndefined();
  });

  it("do the key after g, and close the g menu on any other key", () => {
    const escape = { kind: "event", event: { type: "escape" } };
    for (const view of VIEWS.map((v) => ({ ...v, layer: "go" as const })))
      for (const zone of ["page", "panel"] as const) {
        const after = (key: string) => press(view, zone, key);
        // There are no modes to go to: n and r only close the menu.
        expect(after("n")).toEqual(escape);
        expect(after("r")).toEqual(escape);
        // g g goes to the first open step, and in the tree to the top row.
        expect(after("g")).toEqual(
          zone === "panel"
            ? { kind: "row", by: -Infinity }
            : view.active
              ? { kind: "end", which: "first" }
              : escape,
        );
        expect(after("j")).toEqual({ kind: "event", event: { type: "open", layer: "journeys" } });
        expect(after("p")).toEqual({ kind: "event", event: { type: "open", layer: "here" } });
        expect(after("a")).toEqual(
          view.people ? { kind: "event", event: { type: "open", layer: "people" } } : escape,
        );
        for (const key of ["m", "h", "y", "Escape", "Enter", " ", "ArrowLeft"])
          expect(after(key)).toEqual(escape);
        // A field keeps its keys, and Ctrl+B still hides or shows the panel in a review.
        expect(dispatch(bindings, view, "field", { key: "n" })).toBeUndefined();
        if (view.active) expect(press(view, zone, "b", { ctrl: true })).toEqual({ kind: "panel" });
      }
  });

  it("write a note with i, and go to the next reply, or the notes, with R", () => {
    const view = ON_STEP.find((v) => !v.preview);
    if (view === undefined) throw new Error("No active view");
    expect(press(view, "page", "i")).toEqual({ kind: "focus", to: "note" });
    expect(press(view, "page", "R")).toEqual({ kind: "reply" });
    expect(press(view, "page", "c")).toBeUndefined();
  });

  it("walk the review on the page, and the panel's tree with its own keys", () => {
    const view: View = {
      layer: "none",
      active: true,
      panel: true,
      variants: 3,
      people: true,
      preview: false,
    };
    expect(press(view, "page", "l")).toEqual(go(1));
    expect(press(view, "panel", "j")).toEqual({ kind: "row", by: 1 });
    expect(press(view, "panel", "k")).toEqual({ kind: "row", by: -1 });
    expect(press(view, "panel", "Enter")).toEqual({ kind: "pick" });
    // In the tree, l and h open and close a row, as in Neovim's tree.
    expect(press(view, "panel", "l")).toEqual({ kind: "tree", open: true });
    expect(press(view, "panel", "h")).toEqual({ kind: "tree", open: false });
    // The tree has the page's keys but its own: v and Space lift, and H and L go on.
    expect(press(view, "panel", "v")).toEqual({ kind: "lift" });
    expect(press(view, "panel", " ")).toEqual({ kind: "lift" });
    expect(press(view, "panel", "L", { shift: true })).toEqual(go(1, true));
    // y settles the step selected in the tree, not the one on the page.
    expect(press(view, "panel", "y")).toEqual({ kind: "settleSelected" });
    // G goes to the last open step, and in the tree to the bottom row.
    expect(press(view, "page", "G")).toEqual({ kind: "end", which: "last" });
    expect(press(view, "panel", "G")).toEqual({ kind: "row", by: Infinity });
    // From the tree, i goes back to the message, as from the page.
    expect(press(view, "panel", "i")).toEqual({ kind: "focus", to: "note" });
  });
});
