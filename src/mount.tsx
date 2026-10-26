import { createRoot } from "react-dom/client";
import { claim } from "./core/owner";
import { startSession } from "./core/session";
import type { DevAdapter } from "./types";
import { Running } from "./ui/devtools";
import { openHost } from "./ui/host";

/*
 * The dev tools without a React app: `mount` puts them on the page and gives a handle, which
 * is also `window.blueline`, so a page, a test or an agent's browser can start a review and
 * stop the tools. The tools see the page go to another address by itself; a router that
 * changes the page another way calls `moved`.
 */

export interface MountOptions<C> {
  readonly adapter: DevAdapter<C>;
  /** Where the browser keeps the review. */
  readonly storageKey: string;
  /** The attributes that name an element well enough to point at it again. */
  readonly anchors?: readonly string[];
  /** The page's path, for a router that keeps it out of the address's path, as in its hash;
   * each path has its own notes. The address's path when none. */
  readonly path?: () => string;
  /** Goes to a page by its path, as `path` names it, for the tree's other pages. A new
   * address when none. */
  readonly navigate?: (path: string) => void;
}

export interface Blueline {
  /** Starts the review of a journey, on its step by the step's ID or on its first. Says
   *  whether the journey is there. */
  readonly start: (journey: string, step?: string) => boolean;
  /** Reads the page's path again, after the app went to another page. */
  readonly moved: () => void;
  /** Takes the tools off the page. */
  readonly dispose: () => void;
}

declare global {
  interface Window {
    blueline?: Blueline;
  }
}

/** The events that say the page went to another address. */
const MOVES = ["popstate", "hashchange"] as const;

/** Puts the dev tools on the page. A page has one overlay: the newest, from `mount` or
 * `<DevTools>`, takes the one before off. */
export function mount<C>({
  adapter,
  storageKey,
  anchors = ["data-review", "data-testid", "id"],
  path = () => location.pathname,
  navigate,
}: MountOptions<C>): Blueline {
  const session = startSession({ adapter, storageKey, path });
  const host = openHost();
  const root = createRoot(host.container);
  root.render(<Running session={session} anchors={anchors} goTo={{ current: navigate }} />);

  const moved = () => session.moved();
  for (const move of MOVES) window.addEventListener(move, moved);
  // A router that goes by `history.pushState` sends no event; the Navigation API, where the
  // browser has it, says when each navigation ends.
  const navigation =
    "navigation" in window && window.navigation instanceof EventTarget
      ? window.navigation
      : undefined;
  navigation?.addEventListener("navigatesuccess", moved);

  let disposed = false;
  const handle: Blueline = {
    start: session.start,
    moved,
    // A newer overlay and the app can both take these tools off.
    dispose: () => {
      if (disposed) return;
      disposed = true;
      release();
      for (const move of MOVES) window.removeEventListener(move, moved);
      navigation?.removeEventListener("navigatesuccess", moved);
      root.unmount();
      host.dispose();
      session.dispose();
      if (window.blueline === handle) delete window.blueline;
    },
  };
  const release = claim({
    start: (journey, at, fresh) => session.actor.send({ type: "start", journey, at, fresh }),
    // A claim can come from inside a React commit, where a root cannot unmount.
    yield: () => queueMicrotask(handle.dispose),
  });
  window.blueline = handle;
  return handle;
}
