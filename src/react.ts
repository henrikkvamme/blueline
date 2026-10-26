/*
 * Blueline for a React app: the tools as a component on the app's own React, so the app's
 * hooks and the tools' share one React. `react` and `react-dom` are this entry's peers. The
 * main entry (`mount`) brings its own React, for an app of any framework.
 */
export { DevTools, useReviewControl, type DevToolsProps } from "./ui/devtools";
export { registry, useDevTools, useRegistry, type DevChoice } from "./choices";
export { variants, AS_IT_IS, type Patch } from "./part/variants";
export type { Walk as DevWalk } from "./keys/keymap";
export type {
  DevAdapter,
  DevCommand,
  DevJourney,
  DevPerson,
  DevPersonChoice,
  DevResult,
  DevShift,
  DevStep,
  DevVariant,
} from "./types";
