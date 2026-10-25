import { useSyncExternalStore } from "react";

/*
 * The app's routes: plain paths in the address, which the history API changes without a
 * reload. Blueline's sidebar goes to a page with `navigate` too.
 */

const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};
window.addEventListener("popstate", changed);

export function navigate(path: string) {
  if (path !== location.pathname) history.pushState(null, "", path);
  scrollTo({ top: 0 });
  changed();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname);

/** A request's page, by the request's ID. */
export const requestPath = (id: string) => `/requests/${id}`;

/** The request a path opens, if it is a request's page. */
export const requestIn = (path: string) => /^\/requests\/([\w-]+)$/.exec(path)?.[1];
