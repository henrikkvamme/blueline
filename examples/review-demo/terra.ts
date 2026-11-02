import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

/*
 * GPT-6.1 Terra through a Codex app-server, for the first answer: the one line that says what
 * Henrik asked for. It runs on the ChatGPT plan that Codex is signed in with, so it needs no
 * API key.
 *
 * Speed comes from a warm thread. A new thread's first turn took 2.6 to 3.3 s to its first word
 * on fry; a later turn on the same thread took 1.4 to 2.0 s, with a screenshot. So a spare
 * thread is started and warmed with one short turn before he speaks. Each hearing is one turn
 * on it, and after a few hearings a new spare takes over, so the thread stays short. The Fast
 * tier gave no gain, so it is not used.
 *
 * Codex sends its tools and their instructions with every turn, for a coding agent: about 13,700
 * input tokens for a line of twelve words. Without the tools, the skills, the permissions and
 * the repository's AGENTS.md, it sends about 7,400, and the first word came 150 ms sooner at the
 * median (A/B on fry, 24 hearings each). The rest is Codex's own and the user's AGENTS.md in
 * CODEX_HOME. A second CODEX_HOME would drop that too, but it would need a copy of the sign-in,
 * and a token refresh in the copy can sign out the real one.
 */

const MODEL = "gpt-6.1-terra";

/** Hearings on one thread before a new one takes over. */
const TURNS = 8;

/** What Codex leaves out for this: each tool and each instruction that a line does not need. */
const OFF = [
  "apps",
  "plugins",
  "memories",
  "multi_agent",
  "image_generation",
  "browser_use",
  "browser_use_external",
  "browser_annotation_api",
  "in_app_browser",
  "computer_use",
  "shell_tool",
  "shell_snapshot",
  "unified_exec",
  "unified_exec_tty",
  "view_image",
  "sleep_tool",
  "skill_search",
  "tool_suggest",
  "goals",
  "code_mode_host",
  "chronicle",
  "hooks",
  "guardian_approval",
  "collaboration_modes",
  "realtime_conversation",
  "workspace_dependencies",
  "worktrees",
  "mentions_v2",
  "incremental_tools",
];
const BARE = [
  ...[
    "mcp_servers={}",
    "web_search=disabled",
    "project_doc_max_bytes=0",
    "skills.include_instructions=false",
    "include_permissions_instructions=false",
    "include_environment_context=false",
  ].flatMap((setting) => ["-c", setting]),
  ...OFF.flatMap((feature) => ["--disable", feature]),
];

/** A part of his message to Terra: words, or an image as a data URL. */
export type Part =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly url: string };

interface Thread {
  readonly id: Promise<string>;
  turns: number;
}

type Message = {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
};

/**
 * The ears: `hear` streams the line; `close` stops the app-server. Codex runs in an empty
 * folder of its own, so it reads no repository.
 */
export function terra(instructions: string) {
  const cwd = mkdtempSync(join(tmpdir(), "blueline-ears-"));
  let codex: ChildProcess | undefined;
  let last = 0;
  const waiting = new Map<number, { done: (m: unknown) => void; fail: (e: Error) => void }>();
  const listeners = new Set<(m: Message) => void>();

  const write = (message: object) => codex?.stdin?.write(`${JSON.stringify(message)}\n`);

  const call = (method: string, params: object) =>
    new Promise<unknown>((done, fail) => {
      const id = ++last;
      waiting.set(id, { done, fail });
      write({ id, method, params });
    });

  const start = async () => {
    const child = spawn("codex", ["app-server", ...BARE], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    codex = child;
    child.on("exit", () => {
      if (codex !== child) return;
      codex = undefined;
      for (const { fail } of waiting.values()) fail(new Error("Codex stopped"));
      waiting.clear();
      spare = undefined;
    });
    child.on("error", () => undefined);
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (line.trim() === "") return;
      const message = JSON.parse(line) as Message;
      if (message.id !== undefined && message.method !== undefined) {
        // A request from Codex, such as an approval: this turn asks for none, so say no.
        write({ id: message.id, error: { code: -32601, message: "Not here" } });
        return;
      }
      if (typeof message.id === "number") {
        const wait = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error === undefined) wait?.done(message.result);
        else wait?.fail(new Error(message.error.message ?? "Codex said no"));
        return;
      }
      for (const listen of listeners) listen(message);
    });
    await call("initialize", { clientInfo: { name: "blueline-workshop", version: "0" } });
    write({ method: "initialized" });
  };

  let started: Promise<void> | undefined;
  const ready = () => {
    if (codex === undefined) started = undefined;
    started ??= start();
    return started;
  };

  /** Runs one turn on a thread, and streams its words to `on`. Resolves when it ends. */
  const turn = async (
    threadId: string,
    input: readonly object[],
    signal?: AbortSignal,
    on?: (delta: string) => void,
  ) => {
    let turnId: string | undefined;
    let end = () => undefined as void;
    const ended = new Promise<void>((done) => (end = done));
    const listen = (m: Message) => {
      const p = m.params ?? {};
      if (p["threadId"] !== threadId) return;
      if (m.method === "item/agentMessage/delta" && typeof p["delta"] === "string")
        on?.(p["delta"]);
      if (m.method === "turn/completed") end();
    };
    listeners.add(listen);
    const stop = () => {
      if (turnId !== undefined) void call("turn/interrupt", { threadId, turnId }).catch(() => {});
    };
    signal?.addEventListener("abort", stop, { once: true });
    try {
      const started = (await call("turn/start", {
        threadId,
        input,
        effort: "none",
      })) as { turn: { id: string } };
      turnId = started.turn.id;
      if (signal?.aborted) stop();
      await ended;
    } finally {
      listeners.delete(listen);
      signal?.removeEventListener("abort", stop);
    }
  };

  /** A new thread, warmed with one short turn so its connection and prompt are ready. */
  const thread = (): Thread => ({
    turns: 0,
    id: (async () => {
      await ready();
      const made = (await call("thread/start", {
        model: MODEL,
        baseInstructions: instructions,
        sandbox: "read-only",
        approvalPolicy: "never",
        ephemeral: true,
        cwd,
      })) as { thread: { id: string } };
      await turn(made.thread.id, [{ type: "text", text: "Ready?", text_elements: [] }]);
      return made.thread.id;
    })(),
  });

  let spare: Thread | undefined;
  /** One hearing at a time on a thread: new words stop the old hearing. */
  let busy: Promise<void> = Promise.resolve();
  let stopBusy = () => undefined as void;

  return {
    /** Starts Codex and warms the first thread. */
    ready: () => {
      spare ??= thread();
      spare.id.catch(() => (spare = undefined));
    },
    /**
     * Streams the line it heard: `on` gets the line so far as its words come. Rejects when
     * Codex cannot answer, before any word, so the caller can ask another model.
     */
    hear: async (parts: readonly Part[], signal: AbortSignal, on: (line: string) => void) => {
      stopBusy();
      await busy.catch(() => undefined);
      const use = spare ?? thread();
      use.turns += 1;
      if (use.turns >= TURNS) spare = thread();
      else spare = use;
      const threadId = await use.id;
      const mine = new AbortController();
      const end = () => mine.abort();
      signal.addEventListener("abort", end, { once: true });
      stopBusy = end;
      let said = "";
      const input = parts.map((p) =>
        p.type === "text"
          ? { type: "text", text: p.text, text_elements: [] }
          : { type: "image", url: p.url },
      );
      busy = turn(threadId, input, mine.signal, (delta) => {
        said += delta;
        const line = said.trimStart().split("\n")[0]?.trimEnd() ?? "";
        if (line !== "") on(line);
        // One line only: what comes after it is more than he needs.
        if (said.trimStart().includes("\n")) mine.abort();
      });
      try {
        await busy;
      } finally {
        signal.removeEventListener("abort", end);
      }
      if (said === "" && !signal.aborted) throw new Error("Terra said nothing");
    },
    close: () => {
      const child = codex;
      codex = undefined;
      child?.kill();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}
