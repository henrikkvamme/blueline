import { DevTools, type DevAdapter, type DevJourney } from "@henrikkvamme/blueline";
import { Effect, Schedule } from "effect";
import { navigate, requestPath } from "../router";

/*
 * Blueline on the demo, in development only (app.tsx): one journey over both pages. A step
 * opens its page and waits for its part to show. The header's step names its part, so `v`
 * lifts the header's variants.
 */

const LIST = "/";
const REQUEST = requestPath("R-1042");

const JOURNEY: DevJourney<void> = {
  id: "handle-request",
  title: "Handle a request",
  steps: [
    {
      id: "list-rows",
      title: "The requests",
      group: { id: "list", title: "The list" },
      target: ["[data-review=request-table]"],
      look: "Each row says what was asked for, by whom, and how long it waits.",
      try: "Alt+click a row that reads wrong, and write what you expected.",
    },
    {
      id: "list-tabs",
      title: "The status tabs",
      group: { id: "list", title: "The list" },
      target: ["[data-review=status-tabs]"],
      look: "Each tab counts the requests in its status.",
      try: "Click Waiting: the table shows only the requests that wait.",
    },
    {
      id: "request-header",
      title: "The request's header",
      group: { id: "request", title: "One request" },
      target: ["[data-review=request-header]"],
      part: "Request header",
      look: "The header names the request, who asked, and where it is.",
      try: "Press v to lift the header. Enter shows the variant on the page.",
    },
    {
      id: "request-history",
      title: "The history",
      group: { id: "request", title: "One request" },
      target: ["[data-review=request-history]"],
      look: "Each event says who did what, and when.",
    },
    {
      id: "request-decision",
      title: "The decision",
      group: { id: "request", title: "One request" },
      target: ["[data-review=request-decision]"],
      look: "Approve is the one primary action; Send back stays quiet.",
      try: "Write a reply, then click Send back.",
    },
  ],
};

/** The page each step is on, by the step's ID. */
const PAGES: Readonly<Record<string, string>> = {
  "list-rows": LIST,
  "list-tabs": LIST,
  "request-header": REQUEST,
  "request-history": REQUEST,
  "request-decision": REQUEST,
};

/** Waits for the step's part to show on the page, a second at most. */
const shown = (selectors: readonly string[]) =>
  Effect.sync(() => selectors.every((s) => document.querySelector(s) !== null)).pipe(
    Effect.repeat({
      until: (found) => found,
      schedule: Schedule.spaced("50 millis"),
      times: 20,
    }),
    Effect.asVoid,
  );

const adapter: DevAdapter<void> = {
  journeys: [JOURNEY],
  context: () => undefined,
  enter: (step) =>
    Effect.gen(function* () {
      const page = PAGES[step.id];
      if (page !== undefined && location.pathname !== page) navigate(page);
      yield* shown(step.target ?? []);
    }),
};

export default function Review({ path }: { readonly path: string }) {
  return (
    <DevTools adapter={adapter} storageKey="review-demo.review" path={path} navigate={navigate} />
  );
}
