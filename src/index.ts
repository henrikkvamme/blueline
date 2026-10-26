/*
 * Blueline, the dev tools for a web app in development: a review walk through the app's
 * journeys, notes to the coding agent, and keys that work like vim. An app gives an adapter;
 * pages name their choices. This entry brings its own React, for an app of any framework;
 * a React app can use `@henrikkvamme/blueline/react` instead.
 */
export { mount, type Blueline, type MountOptions } from "./mount";
export { registry, type DevChoice } from "./core/registry";
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
