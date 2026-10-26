/*
 * Blueline, the dev tools for a web app in development: a review walk through the app's journeys, notes to the coding
 * agent, and keys that work like vim. An app gives an adapter; pages name their choices.
 */
export { DevTools, useReviewControl, type DevToolsProps } from "./ui/devtools";
export { mount, type Blueline, type MountOptions } from "./mount";
export { registry, useDevTools, useRegistry, type DevChoice } from "./choices";
export { ROUTES } from "./io/routes";
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
