import { PAGE_JOURNEY } from "../part/page";
import type { BluelineConfig, ConfigStep } from "./index";

/*
 * The rules a config keeps. A config comes from the app's file, maybe plain JavaScript, so
 * each rule is checked here, and a config that breaks one is not used: the page has its own
 * review only, and the tree and the console say why.
 */

export type Checked =
  | { readonly kind: "ok"; readonly config: BluelineConfig }
  | { readonly kind: "broken"; readonly reason: string };

/** The action kinds, by the key that names each, with the keys it may have beside it. */
const ACTIONS: Readonly<Record<string, readonly string[]>> = {
  open: [],
  click: [],
  type: ["into"],
  press: ["on", "shift", "ctrl", "alt", "meta"],
  wait: [],
  emit: ["detail"],
};

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether the page's own review has the ID: `page`, or an ID that starts with `page:` or
 * `place:` (part/page.ts). */
const reserved = (id: string) =>
  id === PAGE_JOURNEY || id.startsWith("page:") || id.startsWith("place:");

/** Why one action breaks a rule, or nothing. */
function actionProblem(action: unknown, first: boolean, where: string): string | undefined {
  if (!isObject(action)) return `${where} is not an action`;
  const kinds = Object.keys(action).filter((key) => key in ACTIONS);
  const [kind] = kinds;
  if (kind === undefined || kinds.length > 1)
    return `${where} needs one of ${Object.keys(ACTIONS).join(", ")}`;
  const allowed = [kind, ...(ACTIONS[kind] ?? [])];
  const other = Object.keys(action).find((key) => !allowed.includes(key));
  if (other !== undefined) return `${where} has ${other}, which ${kind} does not take`;
  if (kind !== "emit" && typeof action[kind] !== "string")
    return `${where}: ${kind} needs a string`;
  if (kind === "emit" && typeof action[kind] !== "string")
    return `${where}: emit needs the event's name`;
  if (kind === "type" && typeof action["into"] !== "string")
    return `${where}: type needs into, the field's selector`;
  if (kind === "open" && !first) return `${where}: open may only be the first action of enter`;
  return undefined;
}

/** Why a step's code breaks a rule, or nothing. */
function runProblem(run: unknown, where: string, opens: boolean): string | undefined {
  if (run === undefined || typeof run === "function") return undefined;
  if (!Array.isArray(run)) return `${where} needs actions or a function`;
  const actions: readonly unknown[] = run;
  for (const [i, action] of actions.entries()) {
    const problem = actionProblem(action, opens && i === 0, `${where}'s action ${String(i + 1)}`);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

const RUNS = ["enter", "setup", "reset", "exit"] as const satisfies readonly (keyof ConfigStep)[];

/** Why a step breaks a rule, or nothing. */
function stepProblem(step: unknown, where: string): string | undefined {
  if (!isObject(step)) return `${where} is not a step`;
  for (const key of ["id", "title", "look", "group"] as const)
    if (typeof step[key] !== "string") return `${where} needs ${key}, a string`;
  const name = `The step ${String(step["id"])}`;
  if (reserved(String(step["id"])))
    return `${name} has an ID the page's own review uses: page, page: or place:`;
  for (const key of RUNS) {
    const problem = runProblem(step[key], `${name}'s ${key}`, key === "enter");
    if (problem !== undefined) return problem;
  }
  const ready = step["ready"];
  if (
    ready !== undefined &&
    typeof ready !== "function" &&
    !(Array.isArray(ready) && ready.every((s) => typeof s === "string"))
  )
    return `${name}'s ready needs selectors or a function`;
  const timeout = step["timeout"];
  if (timeout !== undefined && !(typeof timeout === "number" && timeout > 0))
    return `${name}'s timeout needs a number of milliseconds above 0`;
  const variants = step["variants"];
  if (variants === undefined) return undefined;
  if (!Array.isArray(variants)) return `${name}'s variants need a list`;
  const labels = new Set<string>();
  for (const variant of variants) {
    if (!isObject(variant) || typeof variant["label"] !== "string")
      return `${name} has a variant with no label`;
    const label = variant["label"];
    if (labels.has(label)) return `${name} has two variants labelled ${label}`;
    labels.add(label);
    const problem = runProblem(variant["show"], `${name}'s variant ${label}`, false);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/** Why the config breaks a rule, or nothing. */
function problemOf(config: unknown): string | undefined {
  if (!isObject(config) || !Array.isArray(config["journeys"]))
    return "The config needs journeys: export default defineConfig({ journeys: [...] })";
  const journeys = new Set<string>();
  const steps = new Set<string>();
  for (const journey of config["journeys"]) {
    if (!isObject(journey) || typeof journey["id"] !== "string")
      return "A journey needs an id, a string";
    const id = journey["id"];
    const name = `The journey ${id}`;
    if (reserved(id)) return `${name} has an ID the page's own review uses: page, page: or place:`;
    if (journeys.has(id)) return `Two journeys have the ID ${id}`;
    journeys.add(id);
    if (typeof journey["title"] !== "string") return `${name} needs a title, a string`;
    if (!Array.isArray(journey["steps"])) return `${name} needs steps, a list`;
    for (const [i, step] of journey["steps"].entries()) {
      const problem = stepProblem(step, `${name}'s step ${String(i + 1)}`);
      if (problem !== undefined) return problem;
      const stepId = isObject(step) ? String(step["id"]) : "";
      if (steps.has(stepId)) return `Two steps have the ID ${stepId}`;
      steps.add(stepId);
    }
  }
  return undefined;
}

/** Whether the config keeps the rules. */
const kept = (config: unknown): config is BluelineConfig => problemOf(config) === undefined;

/** The config, or why it breaks a rule. */
export function checkConfig(config: unknown): Checked {
  if (kept(config)) return { kind: "ok", config };
  return { kind: "broken", reason: problemOf(config) ?? "The config breaks a rule" };
}
