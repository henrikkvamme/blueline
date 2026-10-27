import path from "node:path";

/*
 * How `blueline dev` reads the command it wraps: the dev server in it, through the app's
 * package scripts, and the port and host its page uses. It knows Vite (`vite`, `vp dev`)
 * and Next.js (`next dev`); another dev server on Node needs `--port`. Plain functions, with
 * no files, so a test runs them.
 */

export type Known = "vite" | "next";

/** The dev server's part of the command. */
export interface DevServer {
  readonly kind: Known;
  /** Its program's name, as `vite`, `vp` or `next`. */
  readonly program: string;
  /** The words after its program, with the words after the script. */
  readonly args: readonly string[];
  /** The `NAME=value` words its part sets, before it and through `cross-env`. */
  readonly env: Readonly<Record<string, string>>;
}

export type DevCommand =
  | { readonly kind: "found"; readonly server: DevServer }
  /** `needsPort`: the command can run with `blueline dev --port`. */
  | { readonly kind: "refused"; readonly reason: string; readonly needsPort: boolean };

const KNOWN =
  "It knows Vite (vite, vp dev) and Next.js (next dev). For another dev server on Node, name the page's port: blueline dev --port <port> -- <command>. Or load the overlay by a tag by hand: blueline add <origin>.";

const OPERATORS = new Set(["&&", "||", ";", "|", "&"]);

/** A script's text as the parts a shell runs, each as its words, with their quotes. */
export function wordsOf(text: string): string[][] {
  const parts: string[][] = [[]];
  let word: string | undefined;
  let quote: string | undefined;
  const close = () => {
    if (word !== undefined) parts.at(-1)?.push(word);
    word = undefined;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      else if (c === "\\" && quote === '"' && i + 1 < text.length) word += text[(i += 1)] ?? "";
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "\\" && i + 1 < text.length) word = (word ?? "") + (text[(i += 1)] ?? "");
    else if (/\s/.test(c)) close();
    else if ("&|;".includes(c)) {
      close();
      const pair = text.slice(i, i + 2);
      i += OPERATORS.has(pair) && pair !== ";;" ? 1 : 0;
      if (parts.at(-1)?.length !== 0) parts.push([]);
    } else word = (word ?? "") + c;
  }
  close();
  return parts.filter((part) => part.length > 0);
}

const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
const MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
/** The package manager's flags that change nothing here. */
const QUIET = new Set(["-s", "--silent"]);

/** What a part runs, once its `NAME=value` words and wrappers are off. */
interface Run {
  readonly env: Record<string, string>;
  readonly words: readonly string[];
}

function runOf(part: readonly string[]): Run {
  const env: Record<string, string> = {};
  let i = 0;
  const assignments = () => {
    for (; i < part.length && isAssignment(part[i] ?? ""); i += 1) {
      const word = part[i] ?? "";
      const at = word.indexOf("=");
      env[word.slice(0, at)] = word.slice(at + 1);
    }
  };
  assignments();
  for (;;) {
    const word = part[i];
    const next = part[i + 1];
    if (word === "npx" || word === "bunx") i += 1;
    else if (
      (word === "pnpm" && (next === "exec" || next === "dlx")) ||
      (word === "bun" && next === "x")
    )
      i += 2;
    else if (word === "cross-env" || word === "env") {
      i += 1;
      assignments();
      continue;
    } else break;
    // `npx --yes vite` and the like.
    while ((part[i] ?? "").startsWith("-")) i += 1;
  }
  return { env, words: part.slice(i) };
}

/** The dev server a program and its words make, if they make one. */
function serverOf(run: Run): DevServer | undefined {
  const [first = "", ...args] = run.words;
  const program = path.basename(first);
  const sub = args[0];
  if (program === "vite" && !["build", "preview", "optimize"].includes(sub ?? ""))
    return { kind: "vite", program, args, env: run.env };
  if (program === "vp" && sub === "dev") return { kind: "vite", program, args, env: run.env };
  if (program === "next" && sub === "dev") return { kind: "next", program, args, env: run.env };
  return undefined;
}

/** The script a package manager's words run, with the words after it; or none. */
function scriptOf(
  words: readonly string[],
  scripts: Readonly<Record<string, string>>,
): { name: string; extra: readonly string[] } | { refused: string } | undefined {
  const [manager = "", ...rest] = words;
  if (!MANAGERS.has(manager)) return undefined;
  let i = 0;
  while ((rest[i] ?? "").startsWith("-")) {
    const flag = rest[i] ?? "";
    if (!QUIET.has(flag))
      return {
        refused: `blueline dev reads the scripts of the root's own package.json, and does not know ${manager} ${flag}. Run it in the package's own folder.`,
      };
    i += 1;
  }
  const named = rest[i];
  const run = named === "run" || named === "run-script";
  const name = run ? rest[i + 1] : named;
  if (name === undefined) return undefined;
  // npm runs a script only by `run`; the others run one by its name too, and else a
  // program of the package's, as `pnpm vite`.
  if (!run && manager === "npm") return undefined;
  if (!run && !(name in scripts) && ["vite", "vp", "next"].includes(name)) return undefined;
  if (!(name in scripts)) return { refused: `The root's package.json has no script ${name}.` };
  const extra = rest.slice(i + (run ? 2 : 1));
  return { name, extra: extra[0] === "--" ? extra.slice(1) : extra };
}

/** The dev server in the command's words, through the root's package scripts. */
export function devCommandOf(
  words: readonly string[],
  scripts: Readonly<Record<string, string>>,
): DevCommand {
  const servers: DevServer[] = [];
  let refused: string | undefined;
  let nodeOptions = false;
  /** `env`: the `NAME=value` words of the scripts that run this part, which it inherits. */
  const visit = (part: readonly string[], depth: number, env: Readonly<Record<string, string>>) => {
    const own = runOf(part);
    const run = { ...own, env: { ...env, ...own.env } };
    if ("NODE_OPTIONS" in run.env) nodeOptions = true;
    const script = scriptOf(run.words, scripts);
    if (script !== undefined && "refused" in script) refused ??= script.refused;
    else if (script !== undefined) {
      if (depth > 8) return void (refused ??= `The script ${script.name} runs itself.`);
      const parts = wordsOf(scripts[script.name] ?? "");
      // The package manager puts the words after the script at the end of its text.
      parts.at(-1)?.push(...script.extra);
      for (const each of parts) visit(each, depth + 1, run.env);
    } else {
      const server = serverOf(run);
      if (server !== undefined) servers.push(server);
    }
  };
  visit(words, 0, {});
  if (nodeOptions)
    return {
      kind: "refused",
      reason:
        "The command sets NODE_OPTIONS itself, which would drop the preload blueline dev needs. Set NODE_OPTIONS in the environment instead, where blueline dev adds to it.",
      needsPort: false,
    };
  if (refused !== undefined) return { kind: "refused", reason: refused, needsPort: false };
  const [server, other] = servers;
  if (server === undefined)
    return {
      kind: "refused",
      reason: `The command runs no dev server that blueline dev knows. ${KNOWN}`,
      needsPort: true,
    };
  if (other !== undefined)
    return {
      kind: "refused",
      reason: `The command runs two dev servers, ${server.program} and ${other.program}. Name the page's port: blueline dev --port <port> -- <command>.`,
      needsPort: true,
    };
  return { kind: "found", server };
}

/** What a resolved Vite config says of its server. */
export interface ViteServer {
  readonly port?: number | undefined;
  readonly host?: string | boolean | undefined;
  readonly https?: boolean | undefined;
  readonly allowedHosts?: readonly string[] | true | undefined;
}

/** Where the page's dev server listens. `host` true is every address. */
export interface Listen {
  readonly port: number;
  readonly host: string | true;
  readonly https: boolean;
  /** The names a page's `Host` may have besides the loopback ones, or true for any. */
  readonly allowedHosts: readonly string[] | true;
}

/** The value of each flag in `names`, the last one given; `true` for one with no value
 * where its value may be left out. */
function flagOf(
  args: readonly string[],
  names: readonly string[],
  optional = false,
): string | true | undefined {
  let found: string | true | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!names.includes(name)) continue;
    if (equals !== -1) found = arg.slice(equals + 1);
    else {
      const next = args[i + 1];
      if (next !== undefined && !(optional && next.startsWith("-"))) {
        found = next;
        i += 1;
      } else if (optional) found = true;
    }
  }
  return found;
}

const portIn = (value: string | true | undefined) => {
  const port = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
};

/** Where the dev server's page listens: its flags, then its own `PORT` or config, then the
 * dev server's default. */
export function listenOf(
  server: DevServer,
  env: Readonly<Record<string, string | undefined>>,
  config: ViteServer,
): Listen {
  const { args } = server;
  if (server.kind === "next") {
    const host = flagOf(args, ["-H", "--hostname"]);
    return {
      port:
        portIn(flagOf(args, ["-p", "--port"])) ??
        portIn(server.env["PORT"]) ??
        portIn(env["PORT"]) ??
        3000,
      host: typeof host === "string" ? host : true,
      https: args.includes("--experimental-https"),
      allowedHosts: [],
    };
  }
  const host = flagOf(args, ["--host"], true);
  return {
    port: portIn(flagOf(args, ["--port"])) ?? config.port ?? 5173,
    host: host ?? (config.host === false ? undefined : config.host) ?? "localhost",
    https: args.includes("--https") || config.https === true,
    allowedHosts: config.allowedHosts ?? [],
  };
}

/** What Vite's own words say of its config: its root, config file, mode and loader. */
export interface ViteInputs {
  readonly root: string | undefined;
  readonly file: string | undefined;
  readonly mode: string | undefined;
  readonly loader: string | undefined;
}

/** Vite's flags that take a value, and those whose value may be left out. */
const VALUED = new Set([
  "--port",
  "--base",
  "-l",
  "--logLevel",
  "-c",
  "--config",
  "-m",
  "--mode",
  "--configLoader",
  "-f",
  "--filter",
]);
const OPTIONAL = new Set(["--host", "--open", "-d", "--debug"]);

export function viteInputsOf(args: readonly string[]): ViteInputs {
  let root: string | undefined;
  const words = args[0] === "dev" || args[0] === "serve" ? args.slice(1) : args;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    if (word.startsWith("-")) {
      if (word.includes("=")) continue;
      const next = words[i + 1];
      if (VALUED.has(word) || (OPTIONAL.has(word) && next !== undefined && !next.startsWith("-")))
        i += 1;
    } else root ??= word;
  }
  const text = (value: string | true | undefined) =>
    typeof value === "string" ? value : undefined;
  return {
    root,
    file: text(flagOf(words, ["-c", "--config"])),
    mode: text(flagOf(words, ["-m", "--mode"])),
    loader: text(flagOf(words, ["--configLoader"])),
  };
}
