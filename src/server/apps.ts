import path from "node:path";
import type { ChannelFiles } from "./channel.ts";

/*
 * The apps `blueline serve` keeps, without the network or the files, so a test can run them.
 * An app is one root, by its real path; its repository is the `git` top level of the root.
 * Each dev server that registers the app owns the origin it gave, for as long as its
 * registration is open; the app stays after the last one ends, so its notes can still be
 * read and answered. A kept origin, for a script tag by hand, stays until it is removed.
 */

export interface App {
  /** The app's part of its routes, `/blueline/<name>/`; one root's on the machine. */
  readonly name: string;
  readonly root: string;
  readonly repository: string;
  readonly files: ChannelFiles;
  /** The origins kept for a script tag by hand (`blueline add`). */
  readonly kept: readonly string[];
}

/** The files a dev server may give, each as an absolute path or one from the root. */
export type GivenFiles = Partial<Record<keyof ChannelFiles, string>>;

/** An app's files: those given, from its root, and the rest in `<root>/.blueline/`. */
export function filesOf(root: string, given: GivenFiles = {}): ChannelFiles {
  const at = (file: string | undefined) =>
    file === undefined ? undefined : path.resolve(root, file);
  const feedback = at(given.feedback) ?? path.join(root, ".blueline", "feedback.jsonl");
  return {
    feedback,
    status: at(given.status) ?? path.join(root, ".blueline", "status.json"),
    // Beside the notes, as the Vite plugin and `blueline listen` keep them.
    images: at(given.images) ?? path.join(path.dirname(feedback), "images"),
    listening: at(given.listening) ?? `${feedback}.listening.json`,
  };
}

/** A root's name: its repository's folder, then its path in the repository, as one word. */
export function nameOf(repository: string, root: string): string {
  const inside = path.relative(repository, root).split(path.sep).filter(Boolean);
  const name = [path.basename(repository), ...inside]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name === "" ? "app" : name;
}

const sameFiles = (a: ChannelFiles, b: ChannelFiles) =>
  a.feedback === b.feedback &&
  a.status === b.status &&
  a.images === b.images &&
  a.listening === b.listening;

export interface Apps {
  /**
   * The app for `root`, made the first time. A registration while the app has open ones
   * cannot change its files: "conflict".
   */
  readonly app: (root: string, repository: string, files: ChannelFiles) => App | "conflict";
  readonly rooted: (root: string) => App | undefined;
  /** Keeps an origin for the app, or removes it; says whether the app had it. */
  readonly keep: (name: string, origin: string, keep: boolean) => boolean;
  /** Opens a registration of the app's origin; the function ends it. */
  readonly open: (name: string, origin: string) => () => void;
  readonly named: (name: string) => App | undefined;
  /** Whether a page of `origin` may use the app: one of its open registrations gave it, or
   * the app keeps it. */
  readonly allows: (name: string, origin: string) => boolean;
  readonly inRepository: (repository: string) => readonly App[];
  readonly all: () => readonly App[];
}

/** The apps, from those kept before. `changed` runs when the apps to keep change. */
export function makeApps(kept: readonly App[], changed: () => void): Apps {
  const byRoot = new Map(kept.map((a) => [a.root, a]));
  const byName = new Map(kept.map((a) => [a.name, a]));
  /** Each app's open registrations, as their origins; one origin may be there twice. */
  const open = new Map<string, string[]>();

  function put(app: App) {
    byRoot.set(app.root, app);
    byName.set(app.name, app);
    changed();
    return app;
  }

  function freeName(repository: string, root: string) {
    const base = nameOf(repository, root);
    let name = base;
    for (let n = 2; byName.has(name); n += 1) name = `${base}-${String(n)}`;
    return name;
  }

  return {
    app(root, repository, files) {
      const known = byRoot.get(root);
      if (known !== undefined && sameFiles(known.files, files) && known.repository === repository)
        return known;
      if (known !== undefined && (open.get(known.name)?.length ?? 0) > 0) return "conflict";
      const name = known?.name ?? freeName(repository, root);
      return put({ name, root, repository, files, kept: known?.kept ?? [] });
    },
    rooted: (root) => byRoot.get(root),
    keep(name, origin, keep) {
      const app = byName.get(name);
      if (app === undefined) return false;
      const had = app.kept.includes(origin);
      if (had !== keep)
        put({ ...app, kept: keep ? [...app.kept, origin] : app.kept.filter((o) => o !== origin) });
      return had;
    },
    open(name, origin) {
      const origins = open.get(name) ?? [];
      origins.push(origin);
      open.set(name, origins);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        origins.splice(origins.indexOf(origin), 1);
      };
    },
    named: (name) => byName.get(name),
    allows: (name, origin) =>
      (open.get(name)?.includes(origin) ?? false) ||
      (byName.get(name)?.kept.includes(origin) ?? false),
    inRepository: (repository) => [...byRoot.values()].filter((a) => a.repository === repository),
    all: () => [...byRoot.values()],
  };
}
