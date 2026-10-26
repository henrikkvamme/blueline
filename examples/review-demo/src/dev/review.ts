import { mount, type DevAdapter, type DevJourney } from "@henrikkvamme/blueline";
import { navigate, requestPath } from "../router";

/*
 * Blueline on the demo, in development only (app.tsx): one journey over both pages. A step
 * opens its page and waits for its part to show. The rows' and the header's steps name
 * their parts, so `v` lifts their variants. The code is plain Promises.
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
      part: "Request rows",
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
      try: "Lift the header to see its variants side by side, then pick one in the panel.",
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

/** Waits for the step's part to show on the page: a second at most, or until the walk goes
 *  on without it. */
async function shown(selectors: readonly string[], signal: AbortSignal) {
  for (let tries = 0; tries < 20 && !signal.aborted; tries += 1) {
    if (selectors.every((s) => document.querySelector(s) !== null)) return;
    await new Promise((done) => setTimeout(done, 50));
  }
}

const adapter: DevAdapter<void> = {
  journeys: [JOURNEY],
  context: () => undefined,
  enter: async (step, { signal }) => {
    const page = PAGES[step.id];
    if (page !== undefined && location.pathname !== page) navigate(page);
    await shown(step.target ?? [], signal);
  },
};

mount({ adapter, storageKey: "review-demo.review", navigate });
