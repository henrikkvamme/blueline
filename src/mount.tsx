import { createRoot } from "react-dom/client";
import { claim, owner } from "./core/owner";
import { part } from "./part/part";
import { startSession } from "./core/session";
import { configAdapter } from "./config/adapter";
import { checkConfig } from "./config/rules";
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
  /** Declares a part of the page drawn by the app's own code (part/part.ts). */
  readonly part: typeof part;
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
export function mount<C>(options: MountOptions<C>): Blueline {
  return mountTools(options);
}

function mountTools<C>({
  adapter,
  storageKey,
  anchors = ["data-review", "data-testid", "id"],
  path = () => location.pathname,
  navigate,
  problem,
}: MountOptions<C> & { readonly problem?: string | undefined }): Blueline {
  const session = startSession({ adapter, storageKey, path, problem });
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
    part,
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

export interface PageOptions {
  /** Where the browser keeps the review. */
  readonly storageKey: string;
  /** Where the page's channel is: the dev server's routes when none. */
  readonly routes?: NonNullable<DevAdapter<void>["channel"]>;
  /** The app's journeys as data, from `blueline.config.ts` (config/index.ts). */
  readonly config?: unknown;
  /** Why the page could not load the app's config. */
  readonly problem?: string;
}

/** The page's own review, as a script tag or the Vite plugin puts it on a page, with the
 * app's config. A config that breaks a rule is not used: the page has its own review only,
 * and the tree and the console say why. Does nothing when an overlay owns the page already,
 * as the app's own `mount` or `<DevTools>`: the app's tools come first. */
export function mountPage({
  storageKey,
  routes,
  config,
  problem: unloaded,
}: PageOptions): Blueline | undefined {
  if (owner() !== undefined) return undefined;
  const channel = routes === undefined ? {} : { channel: routes };
  const checked = config === undefined ? undefined : checkConfig(config);
  if (checked?.kind === "ok")
    return mount({
      adapter: configAdapter(checked.config, { storageKey, ...channel }),
      storageKey,
    });
  const problem = checked?.kind === "broken" ? checked.reason : unloaded;
  if (problem !== undefined) console.error(`Blueline does not use the config: ${problem}`);
  const adapter: DevAdapter<void> = {
    journeys: [],
    context: () => undefined,
    enter: () => undefined,
    ...channel,
  };
  return mountTools({ adapter, storageKey, problem });
}
