import { afterEach, describe, expect, it, vi } from "vitest";

/** A fresh copy of a module, as a second bundle of Blueline loads its own. */
async function copyOf<M>(load: () => Promise<M>): Promise<M> {
  vi.resetModules();
  return load();
}
const loadParts = () => import("../src/part/store");
const loadRegistry = () => import("../src/core/registry");
const part = (id: string) => ({
  id,
  name: "Card",
  labels: ["A", "B"],
  states: [],
  node: () => null,
});

describe("the state copies of Blueline share", () => {
  afterEach(() => {
    for (const name of ["parts", "registry", "test"])
      Reflect.deleteProperty(globalThis, Symbol.for(`blueline.${name}`));
    vi.restoreAllMocks();
  });

  it("is one store of parts, which tells each copy's listeners, and stops when one leaves", async () => {
    const one = (await copyOf(loadParts)).parts;
    const two = (await copyOf(loadParts)).parts;
    expect(one).not.toBe(two);
    const heard = vi.fn();
    const leave = two.subscribe(heard);
    const remove = one.add(part("1"));
    expect(two.current().instances.map((i) => i.id)).toEqual(["1"]);
    expect(heard).toHaveBeenCalledTimes(1);
    leave();
    remove();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(two.current().instances).toEqual([]);
  });

  it("lets a new copy take over while a part is lifted", async () => {
    const one = (await copyOf(loadParts)).parts;
    one.add(part("1"));
    one.lift("1", { drop: () => undefined, undo: () => undefined });
    const two = (await copyOf(loadParts)).parts;
    expect(two.current().lifting?.id).toBe("1");
    two.land();
    expect(one.current().lifting).toBeUndefined();
  });

  it("is one registry of choices", async () => {
    const one = (await copyOf(loadRegistry)).registry;
    const two = (await copyOf(loadRegistry)).registry;
    const choice = { name: "Look", value: "a", options: ["a", "b"], choose: () => undefined };
    one.set("page", { choices: [choice], commands: [] });
    expect(two.choice("Look")).toBe(choice);
  });

  it("keeps a copy of another protocol apart, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Reflect.set(globalThis, Symbol.for("blueline.test"), { protocol: 0, state: { old: true } });
    const { shared } = await copyOf(() => import("../src/core/shared"));
    expect(shared("test", () => ({ old: false }))).toEqual({ old: false });
    shared("test", () => ({ old: false }));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
