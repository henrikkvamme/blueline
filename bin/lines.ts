import { Option, Schema } from "effect";
import type { Reply } from "../src/io/replies.ts";
import type { Block } from "../src/notes/blocks.ts";

/*
 * The plain parts of the `blueline` command (bin/blueline.ts), without files or a clock, so a
 * test can run them.
 */

export const USAGE = `Usage:
  blueline review <feedback.jsonl> --url <page> [--journey <id>] [--step <id>] [--as <name>]
  blueline listen <feedback.jsonl> [--journey <id>] [--as <name>]
  blueline reply <status.json> <note id> working [--blocks <file.json>]
  blueline reply <status.json> <note id> replied <text> [--variant <label>] [--blocks <file.json>]
  blueline reply <status.json> <note id> settled
  blueline apply <feedback.jsonl> --part <name> [--keep <variant>] [--src <dir>]
  blueline mcp <feedback.jsonl> [--journey <id>] [--as <name>] [--status <status.json>] [--src <dir>] [--wait <seconds>]
  blueline serve [stop]
  blueline add <origin> [--root <dir>]
  blueline remove <origin> [--root <dir>]
  blueline dev [--port <port>] [--host <host>] -- <command>`;

/** What the command line asks for. */
export type Command =
  /** Runs the app's dev command behind a proxy that adds the overlay (src/server/dev.ts). */
  | {
      readonly kind: "dev";
      readonly command: readonly string[];
      /** The page's port, for a dev server that `blueline dev` does not know. */
      readonly port: number | undefined;
      readonly host: string | undefined;
    }
  /** Serves every app's channel on the machine (src/server/serve.ts), or stops it. */
  | { readonly kind: "serve"; readonly stop: boolean }
  /** Keeps an origin for a script tag by hand, or removes it. */
  | {
      readonly kind: "add" | "remove";
      readonly origin: string;
      /** The app's root; the working directory by default. */
      readonly root: string;
    }
  | {
      readonly kind: "listen";
      readonly file: string;
      readonly journey: string | undefined;
      readonly name: string;
    }
  /** Checks the app answers, says the link for the reviewer, then listens. */
  | {
      readonly kind: "review";
      readonly file: string;
      /** The app's page to review, on the dev server. */
      readonly url: string;
      /** The page's own review, `page`, when none is named. */
      readonly journey: string;
      readonly step: string | undefined;
      readonly name: string;
    }
  | {
      readonly kind: "reply";
      readonly file: string;
      readonly id: string;
      readonly state: "working" | "settled" | "replied";
      readonly text: string;
      readonly variant: string | undefined;
      /** A JSON file with the blocks the reply shows (src/notes/blocks.ts). */
      readonly blocks: string | undefined;
    }
  | {
      readonly kind: "apply";
      readonly file: string;
      readonly part: string;
      /** The variant to keep when the reviewer kept more than one. */
      readonly keep: string | undefined;
      /** Where the code is; the working directory by default. */
      readonly src: string;
    }
  /** An MCP server on stdio for one agent (bin/mcp.ts). */
  | {
      readonly kind: "mcp";
      readonly file: string;
      readonly journey: string | undefined;
      /** The reader's name for the claims, as for `listen`. */
      readonly name: string;
      /** The status file; `status.json` beside the feedback file by default. */
      readonly status: string | undefined;
      /** Where the code is, for `apply`; the working directory by default. */
      readonly src: string;
      /** The longest time one wait waits, in ms. */
      readonly waitMs: number;
    };

/** The longest wait: below a 1-hour cache's lifetime less 60 s (ADR 0005). */
const WAIT_MAX_S = 3540;
/** The wait with no `--wait`: below Codex's default tool timeout, 60 s, less 10 s. */
const WAIT_S = 50;

/** The command in the arguments, or none when they make no command. */
export function commandOf(args: readonly string[]): Command | undefined {
  if (args[0] === "dev") return devOf(args.slice(1));
  const words: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const value = args[i + 1];
    if (arg.startsWith("--") && value !== undefined) {
      flags.set(arg.slice(2), value);
      i += 1;
    } else words.push(arg);
  }
  const [kind, file, id, state, text] = words;
  if (kind === "serve" && flags.size === 0 && (words.length === 1 || file === "stop"))
    return words.length <= 2 ? { kind, stop: file === "stop" } : undefined;
  if ((kind === "add" || kind === "remove") && file !== undefined && words.length === 2)
    return { kind, origin: file, root: flags.get("root") ?? "." };
  if (kind === "listen" && file !== undefined && words.length === 2) {
    const journey = flags.get("journey");
    return { kind, file, journey, name: flags.get("as") ?? journey ?? "agent" };
  }
  const url = flags.get("url");
  if (kind === "review" && file !== undefined && url !== undefined && words.length === 2) {
    const journey = flags.get("journey") ?? "page";
    const step = flags.get("step");
    return { kind, file, url, journey, step, name: flags.get("as") ?? journey };
  }
  if (kind === "mcp" && file !== undefined && words.length === 2) {
    const wait = flags.get("wait") ?? String(WAIT_S);
    const seconds = /^\d+$/.test(wait) ? Number(wait) : 0;
    if (seconds < 1 || seconds > WAIT_MAX_S) return undefined;
    const journey = flags.get("journey");
    return {
      kind,
      file,
      journey,
      name: flags.get("as") ?? journey ?? "agent",
      status: flags.get("status"),
      src: flags.get("src") ?? ".",
      waitMs: seconds * 1000,
    };
  }
  const part = flags.get("part");
  if (kind === "apply" && file !== undefined && part !== undefined && words.length === 2)
    return { kind, file, part, keep: flags.get("keep"), src: flags.get("src") ?? "." };
  if (kind !== "reply" || file === undefined || id === undefined) return undefined;
  const variant = flags.get("variant");
  const blocks = flags.get("blocks");
  if (state === "working" && words.length === 4)
    return { kind, file, id, state, text: "", variant, blocks };
  if (state === "settled" && words.length === 4)
    return { kind, file, id, state, text: "", variant, blocks: undefined };
  if (state === "replied" && text !== undefined && words.length === 5)
    return { kind, file, id, state, text, variant, blocks };
  return undefined;
}

/** `blueline dev`'s flags, then `--` and the command. */
function devOf(args: readonly string[]): Command | undefined {
  const split = args.indexOf("--");
  const command = args.slice(split + 1);
  if (split === -1 || command.length === 0) return undefined;
  let port: number | undefined;
  let host: string | undefined;
  for (let i = 0; i < split; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (value === undefined || i + 1 >= split) return undefined;
    if (flag === "--port" && /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536)
      port = Number(value);
    else if (flag === "--host") host = value;
    else return undefined;
  }
  return { kind: "dev", command, port, host };
}

/** A note line from the feedback file, with the fields the listener reads. */
export interface Line {
  readonly raw: string;
  /** The line's ID, which the server gives it (src/vite.ts `stamped`). A line from before
   * that has its place in bytes and a hash of its words, as `@120:1a2b3c`: the place stays as
   * the file only grows, and the hash tells a line of a file started again from the old one. */
  readonly id: string;
  /** Where the line starts, in bytes from the start of the file, or of the read. */
  readonly start: number;
  readonly kind?: string | undefined;
  readonly journey?: string | undefined;
  readonly sentAt?: string | undefined;
  readonly settled?: boolean | undefined;
  /** The steps still open after a settle. */
  readonly left?: number | undefined;
}

const NEWLINE = 10;

/** The fields of a note line the listener reads; the line has more. */
const LineSchema = Schema.fromJsonString(
  Schema.Struct({
    line: Schema.optional(Schema.String),
    kind: Schema.optional(Schema.String),
    journey: Schema.optional(Schema.String),
    sentAt: Schema.optional(Schema.String),
    settled: Schema.optional(Schema.Boolean),
    left: Schema.optional(Schema.Int),
  }),
);
const decodeLine = Schema.decodeUnknownOption(LineSchema);

/** A short hash of a line's words: 32-bit FNV-1a, in base 36. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The whole lines in `bytes`, and how many bytes they use: a line the server is still
 *  writing stays for the next read. A line that is not JSON is skipped. `base` is where the
 *  bytes start in the file. */
export function takeLines(bytes: Uint8Array, base = 0): { lines: Line[]; used: number } {
  const used = bytes.lastIndexOf(NEWLINE) + 1;
  const lines: Line[] = [];
  const encoder = new TextEncoder();
  let start = 0;
  for (const raw of new TextDecoder().decode(bytes.subarray(0, used)).split("\n")) {
    const decoded = decodeLine(raw);
    if (Option.isSome(decoded)) {
      const { line, ...fields } = decoded.value;
      const id = line ?? `@${String(base + start)}:${hashOf(raw)}`;
      lines.push({ raw, id, start: base + start, ...fields });
    }
    start += encoder.encode(raw).length + 1;
  }
  return { lines, used };
}

/** Whether a line needs the agent now. A settle only tells where the review is, so it waits
 *  for the next line that does, and saves the agent a turn; the last settle ends the
 *  review, and the agent applies the kept variants. */
export const wakes = (line: Line) =>
  line.kind !== "settle" || (line.settled === true && line.left === 0);

/** How long ago a note was sent, in words. */
export function ageOf(sentAt: string | undefined, now: number): string {
  const at = sentAt === undefined ? Number.NaN : Date.parse(sentAt);
  if (Number.isNaN(at)) return "at an unknown time";
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** Whether a note that came only now was sent long before: the page or the server held it. */
export const cameLate = (sentAt: string | undefined, now: number, lateMs: number) =>
  sentAt !== undefined && now - Date.parse(sentAt) > lateMs;

/** A note's answer after a reply command: working, one more reply, or settled. A working
 *  reply's blocks are its progress, in place of the last; a reply or a settle ends it. */
export function replyAfter(
  was: Reply | undefined,
  command: Extract<Command, { kind: "reply" }>,
  /** The time now, in ms: a settle keeps it. */
  now: number,
  blocks?: readonly Block[],
): Reply {
  const { progress: _, ...before }: Reply = was ?? { state: "working" };
  if (command.state === "working")
    return { ...before, state: "working", ...(blocks === undefined ? {} : { progress: blocks }) };
  if (command.state === "settled")
    return { ...before, state: "replied", settled: true, settledAt: now };
  const reply = {
    text: command.text,
    ...(command.variant === undefined ? {} : { variant: command.variant }),
    ...(blocks === undefined ? {} : { blocks }),
  };
  return { ...before, state: "replied", replies: [...(before.replies ?? []), reply] };
}
