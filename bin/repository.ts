import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";
import { placeOf } from "../src/server/start.ts";

/*
 * Which feedback files an agent's hook reads: those of the apps in its repository, as
 * `blueline serve` keeps them in its state folder, or the one setup named. A repository is
 * the nearest folder with a `.git` entry, by real path, as the server finds it; a worktree is
 * its own repository.
 */

const env = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));

/** Where the machine's server runs and keeps its apps (src/server/start.ts). */
export const PLACE = Config.all({
  BLUELINE_PORT: env("BLUELINE_PORT"),
  BLUELINE_STATE: env("BLUELINE_STATE"),
  XDG_STATE_HOME: env("XDG_STATE_HOME"),
  HOME: env("HOME"),
}).pipe(Config.map(placeOf));

/** The repository a folder is in, by real path; none outside one. */
export const repositoryOf = Effect.fn(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let at = yield* fs.realPath(folder);
  for (;;) {
    if (yield* fs.exists(path.join(at, ".git"))) return at;
    const up = path.dirname(at);
    if (up === at) return undefined;
    at = up;
  }
});

const KeptApps = Schema.fromJsonString(
  Schema.Struct({
    apps: Schema.Array(
      Schema.Struct({
        repository: Schema.String,
        files: Schema.Struct({ feedback: Schema.String }),
      }),
    ),
  }),
);

/** The feedback files of the repository's apps; none when the server keeps none, or its file
 * does not read. */
export const feedbackOf = Effect.fn(function* (repository: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { state } = yield* PLACE;
  const file = path.join(state, "apps.json");
  if (!(yield* fs.exists(file))) return [];
  const kept = yield* fs.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeEffect(KeptApps)),
    Effect.orElseSucceed(() => ({ apps: [] })),
  );
  return [
    ...new Set(kept.apps.filter((a) => a.repository === repository).map((a) => a.files.feedback)),
  ];
});
