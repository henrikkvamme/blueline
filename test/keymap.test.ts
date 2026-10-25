import { describe, expect, it } from "vitest";
import {
  BINDINGS,
  bindingsFor,
  commandBindings,
  dispatch,
  firstAction,
  helpRows,
  rowAction,
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
const KEYS = [..."abcdefghijklmnopqrstuvwxyzHJKLSY*12?".split(""), "Enter", "Escape", " "];

describe("the keys", () => {
  it("let a tap on the ? menu press each key of each binding it lists", () => {
    for (const view of VIEWS) {
      const listed = [
        ...bindingsFor(bindings, { ...view, layer: "none" }, "page"),
        ...bindingsFor(bindings, { ...view, layer: "none" }, "go"),
      ];
      const rows = helpRows(listed);
      for (const b of listed) {
        const ways = new Set(
          b.keys.map((k) => JSON.stringify(typeof b.does === "function" ? b.does(k) : b.does)),
        );
        const tapped = new Set(
          rows.filter((r) => r.binding === b).map((r) => JSON.stringify(rowAction(r))),
        );
        expect(tapped).toEqual(ways);
      }
    }
  });

  it("stop pointing with Escape in every zone, before what is open closes", () => {
    for (const view of VIEWS)
      for (const zone of ZONES) {
        const aiming = { ...view, aiming: true };
        expect(dispatch(bindings, aiming, zone, { key: "Escape" })).toEqual({
          kind: "aim",
          on: false,
        });
        // Every other key does as it does while not pointing.
        for (const key of KEYS.filter((k) => k !== "Escape"))
          expect(dispatch(bindings, aiming, zone, { key })).toEqual(
            dispatch(bindings, view, zone, { key }),
          );
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
        expect(dispatch(bindings, view, "list", { key })).toBeUndefined();
        const inField = dispatch(bindings, view, "field", { key });
        expect(inField).toEqual(key === "Escape" ? { kind: "blur" } : undefined);
      }
  });

  it("leave keys with Cmd, Ctrl or Alt to the page and the field, but the global ones", () => {
    for (const view of VIEWS)
      for (const zone of ZONES)
        for (const key of KEYS) {
          expect(dispatch(bindings, view, zone, { key, meta: true })).toBeUndefined();
          // Ctrl+J and Ctrl+K go down and up the steps on the page, and select the open
          // steps in the tree; Ctrl+H and Ctrl+L show the variants of a step with more than one.
          const page = zone === "page" || zone === "control";
          const steps = (page && view.active) || zone === "panel" ? ["j", "k"] : [];
          const variants = view.active && view.variants > 1 && (page || zone === "panel");
          const own = [
            ...(page || zone === "panel" ? ["r", "b", "p"] : []),
            ...(view.active ? ["b", "p"] : []),
            ...steps,
            ...(variants ? ["h", "l"] : []),
          ];
          if (!own.includes(key))
            expect(dispatch(bindings, view, zone, { key, ctrl: true })).toBeUndefined();
          expect(dispatch(bindings, view, zone, { key, alt: true })).toBeUndefined();
        }
  });

  it("leave h, j, k and l to the page while no review runs", () => {
    for (const view of VIEWS.filter((v) => !v.active))
      for (const zone of ["page", "control"] as const)
        for (const key of ["h", "j", "k", "l", "J", "K", "Enter"]) {
          expect(dispatch(bindings, view, zone, { key })).toBeUndefined();
          expect(dispatch(bindings, view, zone, { key, ctrl: true })).toBeUndefined();
        }
  });

  it("give each key at most one meaning in a zone", () => {
    for (const view of VIEWS)
      for (const zone of ZONES) {
        const keys = bindingsFor(bindings, view, zone).flatMap((b) =>
          b.keys.map((k) => (b.ctrl === true ? `Ctrl+${k}` : k)),
        );
        expect(new Set(keys).size, `${zone} ${JSON.stringify(view)}`).toBe(keys.length);
      }
  });

  it("do what the ? menu says, for every key it shows", () => {
    for (const view of VIEWS)
      for (const zone of ZONES)
        for (const binding of bindingsFor(bindings, view, zone))
          for (const key of binding.keys) {
            const does = typeof binding.does === "function" ? binding.does(key) : binding.does;
            expect(dispatch(bindings, view, zone, { key, ctrl: binding.ctrl === true })).toEqual(
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
          const does = dispatch(bindings, view, zone, { key });
          if (does === undefined) continue;
          const shown = bindingsFor(bindings, view, zone).some(
            (b) => b.ctrl !== true && b.keys.includes(key),
          );
          expect(shown, `${key} in ${zone}`).toBe(true);
        }
  });

  it("give one key to each thing: y settles and goes on, 0 builds the step again", () => {
    for (const view of VIEWS.filter((v) => v.active && v.layer === "none")) {
      expect(dispatch(bindings, view, "page", { key: "y" })).toEqual({
        kind: "event",
        event: { type: "settle" },
      });
      expect(dispatch(bindings, view, "page", { key: "0" })).toEqual({
        kind: "event",
        event: { type: "reset" },
      });
      for (const key of ["Y", "z", "n", "N", "s"])
        expect(dispatch(bindings, view, "page", { key }), key).toBeUndefined();
      // Tab writes to the page's chat or the step's again.
      expect(dispatch(bindings, view, "page", { key: "Tab" })).toEqual({
        kind: "event",
        event: { type: "chat" },
      });
    }
  });

  it("go across to the variants and down to the steps, in the preview and off it", () => {
    const go = (by: number, open?: boolean) => ({
      kind: "event",
      event: { type: "go", by, ...(open === undefined ? {} : { open }) },
    });
    const variant = (by: number) => ({ kind: "variant", by });
    for (const view of VIEWS.filter((v) => v.active && v.layer === "none"))
      for (const zone of ["page", "control"] as const)
        for (const ctrl of [false, true]) {
          const keys = (key: string) => dispatch(bindings, view, zone, { key, ctrl });
          const many = view.variants > 1;
          expect(keys("j")).toEqual(go(1));
          expect(keys("k")).toEqual(go(-1));
          expect(keys("l")).toEqual(many ? variant(1) : undefined);
          expect(keys("h")).toEqual(many ? variant(-1) : undefined);
          // J and K pass over the settled steps.
          if (!ctrl) {
            expect(keys("J")).toEqual(go(1, true));
            expect(keys("K")).toEqual(go(-1, true));
            expect(keys("H")).toBeUndefined();
            expect(keys("L")).toBeUndefined();
          }
        }
  });

  it("show the variants with Ctrl+H and Ctrl+L, and keep Ctrl+J and Ctrl+K for the tree's open steps", () => {
    const variant = (by: number) => ({ kind: "variant", by });
    for (const view of VIEWS.filter((v) => v.active && v.layer === "none")) {
      for (const zone of ["page", "panel"] as const) {
        const keys = (key: string) => dispatch(bindings, view, zone, { key, ctrl: true });
        const many = view.variants > 1;
        expect(keys("l")).toEqual(many ? variant(1) : undefined);
        expect(keys("h")).toEqual(many ? variant(-1) : undefined);
      }
      expect(dispatch(bindings, view, "panel", { key: "j", ctrl: true })).toEqual({
        kind: "event",
        event: { type: "cursorOpen", by: 1 },
      });
    }
    const rows = helpRows(
      bindingsFor(
        bindings,
        { layer: "none", active: true, panel: false, variants: 3, people: false, preview: true },
        "page",
      ),
    );
    expect(
      rows
        .filter((r) => ["Ctrl+H", "Ctrl+L", "Ctrl+J", "Ctrl+K"].includes(r.key))
        .map((r) => r.label),
    ).toEqual(["Previous variant", "Next variant", "Step after", "Step before"]);
  });

  it("settle with Enter as with y, on the page with no layer open, and leave Enter to the app's control", () => {
    const settle = { kind: "event", event: { type: "settle" } };
    for (const view of VIEWS) {
      const enter = (zone: Zone) => dispatch(bindings, view, zone, { key: "Enter" });
      expect(enter("page")).toEqual(view.active && view.layer === "none" ? settle : undefined);
      // A focused button, link or field of the app's keeps Enter, so it still clicks.
      expect(enter("control")).toBeUndefined();
      expect(enter("field")).toBeUndefined();
      // The tree keeps its own Enter.
      if (view.layer === "none") expect(enter("panel")).toEqual({ kind: "pick" });
      // y settles from a control of the app's too: it is no key of a control.
      if (view.active && view.layer === "none")
        expect(dispatch(bindings, view, "control", { key: "y" })).toEqual(settle);
    }
  });

  it("settle once for a held key: the key's repeats do nothing", () => {
    for (const view of VIEWS.filter((v) => v.active && v.layer === "none")) {
      for (const zone of ["page", "control", "panel"] as const)
        expect(dispatch(bindings, view, zone, { key: "y", repeat: true })).toBeUndefined();
      expect(dispatch(bindings, view, "page", { key: "Enter", repeat: true })).toBeUndefined();
      // A held j still walks on, as it settles nothing.
      expect(dispatch(bindings, view, "page", { key: "j", repeat: true })).toEqual({
        kind: "event",
        event: { type: "go", by: 1 },
      });
    }
  });

  it("hide and show the panel with Ctrl+B, and preview with Ctrl+P, from every zone in a review", () => {
    for (const view of VIEWS)
      for (const zone of ZONES) {
        // With no review on, Ctrl+B hides or shows the panel from the page, after the page's
        // own keys, and from the tree; Ctrl+P previews from the page.
        expect(dispatch(bindings, view, zone, { key: "b", ctrl: true })).toEqual(
          view.active || zone === "page" || zone === "control" || zone === "panel"
            ? { kind: "panel" }
            : undefined,
        );
        // The tree is the tools' own, so it has Ctrl+P with no review on too.
        expect(dispatch(bindings, view, zone, { key: "p", ctrl: true })).toEqual(
          view.active || zone === "page" || zone === "control" || zone === "panel"
            ? { kind: "event", event: { type: "preview" } }
            : undefined,
        );
      }
  });

  it("take Ctrl+B and Ctrl+P before the page only while the review is on", () => {
    for (const view of VIEWS) {
      const first = (key: string, more: object) => firstAction(view, { key, ...more });
      expect(first("b", { ctrl: true })).toEqual(view.active ? { kind: "panel" } : undefined);
      expect(first("p", { ctrl: true })).toEqual(
        view.active ? { kind: "event", event: { type: "preview" } } : undefined,
      );
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
    const preview = { kind: "event", event: { type: "preview" } };
    const leave = { kind: "event", event: { type: "leave" } };
    for (const view of VIEWS) {
      // The preview ends as Ctrl+P ends it: the tools come back as they were.
      expect(dispatch(bindings, view, "page", { key: "Escape" })).toEqual(
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
      expect(dispatch(bindings, view, "panel", { key: "Escape" })).toEqual(
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
        expect(dispatch(bindings, view, zone, { key: "Escape" })).toEqual({
          kind: "event",
          event: { type: "leave" },
        });
    for (const view of VIEWS)
      for (const zone of ZONES)
        for (const key of KEYS)
          expect(dispatch(bindings, view, zone, { key })).not.toEqual({ kind: "panel" });
  });

  it("open the g menu with g, on the page and in the tree", () => {
    for (const view of VIEWS.filter((v) => v.layer === "none"))
      for (const zone of ["page", "panel"] as const)
        expect(dispatch(bindings, view, zone, { key: "g" })).toEqual({
          kind: "event",
          event: { type: "open", layer: "go" },
        });
    // a is the g menu's alone, so the page keeps the plain key.
    for (const view of VIEWS.filter((v) => v.layer === "none"))
      expect(dispatch(bindings, view, "page", { key: "a" })).toBeUndefined();
  });

  it("do the key after g, and close the g menu on any other key", () => {
    const escape = { kind: "event", event: { type: "escape" } };
    for (const view of VIEWS.map((v) => ({ ...v, layer: "go" as const })))
      for (const zone of ["page", "panel"] as const) {
        const after = (key: string) => dispatch(bindings, view, zone, { key });
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
        for (const key of ["m", "h", "y", "Escape", "Enter"]) expect(after(key)).toEqual(escape);
        // A field keeps its keys, and Ctrl+B still hides or shows the panel in a review.
        expect(dispatch(bindings, view, "field", { key: "n" })).toBeUndefined();
        if (view.active)
          expect(dispatch(bindings, view, zone, { key: "b", ctrl: true })).toEqual({
            kind: "panel",
          });
      }
  });

  it("lift the step's part with v, or say there is nothing to lift", () => {
    for (const view of VIEWS.filter((v) => v.layer === "none"))
      expect(dispatch(bindings, view, "page", { key: "v" })).toEqual(
        view.active ? { kind: "lift" } : undefined,
      );
  });

  it("write a note with i, and go to the next reply, or the notes, with R", () => {
    const view = VIEWS.find((v) => v.active && v.layer === "none" && !v.preview);
    if (view === undefined) throw new Error("No active view");
    expect(dispatch(bindings, view, "page", { key: "i" })).toEqual({ kind: "focus", to: "note" });
    expect(dispatch(bindings, view, "page", { key: "R" })).toEqual({ kind: "reply" });
    expect(dispatch(bindings, view, "page", { key: "c" })).toBeUndefined();
  });

  it("leave p alone to the page: Ctrl+P previews", () => {
    for (const view of VIEWS)
      expect(dispatch(bindings, view, "page", { key: "p" })).toBeUndefined();
  });

  it("undo with u and redo with Ctrl+R outside fields, and leave both to a field", () => {
    for (const view of VIEWS)
      for (const zone of ["page", "panel"] as const) {
        expect(dispatch(bindings, view, zone, { key: "u" })).toEqual({
          kind: "event",
          event: { type: "undo" },
        });
        expect(dispatch(bindings, view, zone, { key: "r", ctrl: true })).toEqual({
          kind: "event",
          event: { type: "redo" },
        });
        expect(dispatch(bindings, view, "field", { key: "u" })).toBeUndefined();
        expect(dispatch(bindings, view, "field", { key: "r", ctrl: true })).toBeUndefined();
      }
  });

  it("walk the review with j and k on the page, and the panel's tree with them", () => {
    const view: View = {
      layer: "none",
      active: true,
      panel: true,
      variants: 3,
      people: true,
      preview: false,
    };
    expect(dispatch(bindings, view, "page", { key: "j" })).toEqual({
      kind: "event",
      event: { type: "go", by: 1 },
    });
    expect(dispatch(bindings, view, "panel", { key: "j" })).toEqual({ kind: "row", by: 1 });
    expect(dispatch(bindings, view, "panel", { key: "Enter" })).toEqual({ kind: "pick" });
    // In the tree, l and h open and close a row, as in Neovim's tree.
    expect(dispatch(bindings, view, "panel", { key: "l" })).toEqual({ kind: "tree", open: true });
    expect(dispatch(bindings, view, "panel", { key: "h" })).toEqual({
      kind: "tree",
      open: false,
    });
    // The tree has the page's keys but its own: v lifts.
    expect(dispatch(bindings, view, "panel", { key: "v" })).toEqual({ kind: "lift" });
    // y settles the step selected in the tree, not the one on the page.
    expect(dispatch(bindings, view, "panel", { key: "y" })).toEqual({ kind: "settleSelected" });
    // G goes to the last open step, and in the tree to the bottom row.
    expect(dispatch(bindings, view, "page", { key: "G" })).toEqual({ kind: "end", which: "last" });
    expect(dispatch(bindings, view, "panel", { key: "G" })).toEqual({
      kind: "row",
      by: Infinity,
    });
    // From the tree, i goes back to the message, as from the page.
    expect(dispatch(bindings, view, "panel", { key: "i" })).toEqual({
      kind: "focus",
      to: "note",
    });
  });
});
