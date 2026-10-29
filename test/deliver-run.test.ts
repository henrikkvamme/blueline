import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tokenIn } from "../src/deliver/agents";

/*
 * Delivery from the source, as a harness runs it (ADR 0005): the hooks and `blueline wait`
 * on their JSON, `blueline listen`, and `blueline serve`'s wake, which starts a fake agent
 * (test/fixtures/fake-agent.ts). The test process stands in for the agent's harness: each
 * command it starts finds it as the first ancestor that is not a shell.
 */

const COMMAND = path.join(import.meta.dirname, "..", "bin", "blueline.ts");
const FAKE = path.join(import.meta.dirname, "fixtures", "fake-agent.ts");

const note = (id: string) =>
  `${JSON.stringify({ line: id, kind: "note", id: `note-${id}`, journey: "j" })}\n`;

let dir = "";
let feedback = "";
const children: ChildProcess[] = [];

/** No harness of the machine's own takes part. */
const env = (more: Record<string, string> = {}) => {
  const { CLAUDE_PID: _, T3CODE_CLI_PATH: __, ...rest } = process.env;
  return { ...rest, BLUELINE_STATE: path.join(dir, "state"), ...more };
};

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  if (existsSync(`${dir}/out.pid`)) {
    try {
      process.kill(Number(readFileSync(`${dir}/out.pid`, "utf8")), "SIGKILL");
    } catch {
      // It ended.
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function repository() {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "blueline-deliver-")));
  mkdirSync(path.join(dir, ".git"));
  feedback = path.join(dir, ".blueline", "feedback.jsonl");
  mkdirSync(path.dirname(feedback), { recursive: true });
  writeFileSync(feedback, "");
}

/** Runs a hook as the harness does: its JSON on stdin, its answer on stdout. */
function hook(event: string, more: object = {}, session = "s1", harness = "claude") {
  return hookOn(["--feedback", feedback], event, more, session, harness);
}

/** A hook with the files `args` name: none takes the repository's apps. */
function hookOn(
  args: readonly string[],
  event: string,
  more: object = {},
  session = "s1",
  harness = "claude",
) {
  const ran = spawnSync(process.execPath, [COMMAND, "hook", harness, ...args], {
    input: JSON.stringify({ session_id: session, cwd: dir, hook_event_name: event, ...more }),
    env: env(),
    encoding: "utf8",
  });
  expect(ran.status).toBe(0);
  return ran.stdout.trim() === "" ? undefined : (JSON.parse(ran.stdout) as Record<string, unknown>);
}

const agents = () =>
  JSON.parse(readFileSync(`${feedback}.agents.json`, "utf8")) as {
    sessions: Record<string, { state: string; joined: boolean; blocks: number }>;
    reservations: Record<string, unknown>;
  };

const contextOf = (output: Record<string, unknown> | undefined) =>
  (output?.["hookSpecificOutput"] as { additionalContext?: string } | undefined)?.additionalContext;

const until = async (check: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 100));
  }
  return true;
};

// Each hook is a Node process from the source: under a full run, a test takes seconds.
describe("the hooks", { timeout: 30_000 }, () => {
  it("give a joined session its new lines in its turn, and nothing to one that did not join", () => {
    repository();
    hook("SessionStart");
    appendFileSync(feedback, note("A"));
    // Not joined: it registers, and gets nothing.
    expect(hook("UserPromptSubmit", { prompt: "Fix the tests" })).toBeUndefined();
    expect(agents().sessions["s1"]).toMatchObject({ state: "busy", joined: false });
    // A tool call that runs `blueline listen` joins it, and the batch's answer has the line.
    const batch = hook("PostToolBatch", {
      tool_calls: [
        { tool_input: { command: "pnpm exec blueline listen .blueline/feedback.jsonl" } },
      ],
    });
    expect(contextOf(batch)).toContain('"line":"A"');
    // Each line once.
    expect(hook("PostToolBatch", { tool_calls: [] })).toBeUndefined();
    // A line that comes before its Stop keeps the turn going.
    appendFileSync(feedback, note("B"));
    expect(hook("Stop", { stop_hook_active: false })).toMatchObject({ decision: "block" });
    expect(hook("Stop", { stop_hook_active: true })).toBeUndefined();
    expect(agents().sessions["s1"]?.state).toBe("idle");
    hook("SessionEnd", { reason: "other" });
    expect(agents().sessions["s1"]).toBeUndefined();
  });

  it("stop blocking at Claude's cap, and leave the line for the idle wait", async () => {
    repository();
    hook("PostToolBatch", {
      tool_calls: [{ tool_input: { command: "blueline reply x y settled" } }],
    });
    for (let i = 0; i < 8; i += 1) {
      appendFileSync(feedback, note(`N${String(i)}`));
      expect(hook("Stop", { stop_hook_active: i > 0 })).toMatchObject({ decision: "block" });
    }
    appendFileSync(feedback, note("LAST"));
    // The harness would override a ninth block and end the turn: the hook claims nothing.
    expect(hook("Stop", { stop_hook_active: true })).toBeUndefined();
    expect(agents().sessions["s1"]?.state).toBe("idle");
    const wait = spawnSync(process.execPath, [COMMAND, "wait", "--feedback", feedback], {
      input: JSON.stringify({ session_id: "s1", cwd: dir }),
      env: env(),
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(wait.status).toBe(2);
    expect(wait.stderr).toContain('"line":"LAST"');
  });

  it("let Codex's Stop say nothing as JSON, as Codex expects", () => {
    repository();
    expect(hook("Stop", {}, "c1", "codex")).toEqual({});
    // Also in a repository that no app registered yet.
    expect(hookOn([], "Stop", {}, "c1", "codex")).toEqual({});
  });

  it("count the Stop blocks of a session across its files, as Claude counts them", () => {
    repository();
    const other = path.join(dir, ".blueline", "other.jsonl");
    writeFileSync(other, "");
    keepApps([feedback, other]);
    hookOn([], "PostToolBatch", { tool_calls: [{ tool_input: { command: "blueline listen f" } }] });
    for (let i = 0; i < 8; i += 1) {
      appendFileSync(i % 2 === 0 ? feedback : other, note(`N${String(i)}`));
      expect(hookOn([], "Stop", { stop_hook_active: i > 0 })).toMatchObject({ decision: "block" });
    }
    appendFileSync(feedback, note("LAST"));
    expect(hookOn([], "Stop", { stop_hook_active: true })).toBeUndefined();
  });

  it("wait ends with nothing when its session starts a turn", async () => {
    repository();
    hook("PostToolBatch", { tool_calls: [{ tool_input: { command: "blueline listen f" } }] });
    hook("Stop");
    const wait = spawn(process.execPath, [COMMAND, "wait", "--feedback", feedback], { env: env() });
    children.push(wait);
    wait.stdin.end(JSON.stringify({ session_id: "s1", cwd: dir }));
    const ended = new Promise<number | null>((done) => wait.once("exit", done));
    await new Promise((done) => setTimeout(done, 1_500));
    hook("UserPromptSubmit", { prompt: "Go on" });
    expect(await ended).toBe(0);
  });
});

describe("blueline listen", { timeout: 30_000 }, () => {
  it("joins its session before a note comes, as it runs until it is stopped", async () => {
    repository();
    hook("SessionStart");
    const listen = spawn(process.execPath, [COMMAND, "listen", feedback], { env: env() });
    children.push(listen);
    expect(await until(() => agents().sessions["s1"]?.joined === true, 8_000)).toBe(true);
  });
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise((done) => server.close(done));
  if (typeof address !== "object" || address === null) throw new Error("No port");
  return address.port;
}

/** The apps that a dev server keeps in the state folder, one for each feedback file. */
function keepApps(feedbacks: readonly string[]) {
  const state = path.join(dir, "state");
  mkdirSync(state, { recursive: true });
  const apps = feedbacks.map((file, i) => ({
    name: `app${String(i)}`,
    root: dir,
    repository: dir,
    files: {
      feedback: file,
      status: path.join(dir, ".blueline", `status${String(i)}.json`),
      images: path.join(dir, ".blueline", "images"),
      listening: `${file}.listening.json`,
    },
    kept: [],
  }));
  writeFileSync(path.join(state, "apps.json"), JSON.stringify({ protocol: 2, apps }));
}

/** `blueline serve` with the app kept, and the fake agent as its start adapter: in the user's
 * own start file, or in the one the repository commits. */
async function serve(
  more: Record<string, string>,
  command = [process.execPath, FAKE],
  where: "user" | "repository" = "user",
) {
  const state = path.join(dir, "state");
  keepApps([feedback]);
  const start = { adapter: "command", command };
  if (where === "user")
    writeFileSync(path.join(state, "start.json"), JSON.stringify({ [dir]: { start } }));
  else writeFileSync(path.join(dir, ".blueline.json"), JSON.stringify({ start }));
  const server = spawn(process.execPath, [COMMAND, "serve"], {
    env: env({
      BLUELINE_PORT: String(await freePort()),
      OUT: `${dir}/out`,
      FEEDBACK: feedback,
      ...more,
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.push(server);
  return server;
}

const starts = () =>
  existsSync(`${dir}/out`)
    ? readFileSync(`${dir}/out`, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { pid: number; note: string })
    : [];

describe("the server's wake", () => {
  it("starts one agent with no agent there, starts no second while it works, and starts again once it is killed", async () => {
    repository();
    await serve({ HOLD_MS: "60000" });
    appendFileSync(feedback, note("N1"));
    expect(await until(() => starts().length === 1, 15_000)).toBe(true);
    const [first] = starts();
    expect(first?.note).toContain('"line":"N1"');
    // The note names a command that the agent's shell runs, with no \`blueline\` on its PATH.
    expect(first?.note).toContain(`\`${process.execPath} ${COMMAND} reply `);
    const token = tokenIn(first?.note);
    expect(token).toBeDefined();
    // It joined by its token: the reservation is gone, and its session is busy.
    expect(await until(() => Object.keys(agents().reservations).length === 0, 5_000)).toBe(true);
    expect(Object.values(agents().sessions)).toMatchObject([{ joined: true, state: "busy" }]);
    // A second note while it works starts no one: its hooks take it.
    appendFileSync(feedback, note("N2"));
    await new Promise((done) => setTimeout(done, 8_000));
    expect(starts()).toHaveLength(1);
    // Killed in its turn, it is gone at once, and its line goes to a fresh agent.
    process.kill(first?.pid ?? 0, "SIGKILL");
    expect(await until(() => starts().length === 2, 10_000)).toBe(true);
    expect(starts()[1]?.note).toContain('"line":"N2"');
  }, 60_000);

  it("starts one by the start the repository commits, with no setup of the user's", async () => {
    repository();
    await serve({ HOLD_MS: "60000" }, [process.execPath, FAKE], "repository");
    appendFileSync(feedback, note("N1"));
    expect(await until(() => starts().length === 1, 15_000)).toBe(true);
    expect(starts()[0]?.note).toContain('"line":"N1"');
  }, 60_000);

  it("does not start again on the same lines when the start itself fails", async () => {
    repository();
    const server = await serve({}, [path.join(dir, "no-such-agent")]);
    let said = "";
    server.stderr?.on("data", (data: Buffer) => (said += data.toString()));
    const fails = () => said.split("did not start").length - 1;
    appendFileSync(feedback, note("N1"));
    expect(await until(() => fails() === 1, 15_000)).toBe(true);
    await new Promise((done) => setTimeout(done, 14_000));
    expect(fails()).toBe(1);
    appendFileSync(feedback, note("N2"));
    expect(await until(() => fails() === 2, 15_000)).toBe(true);
  }, 60_000);

  it("does not start again on the same lines when an agent ends before it joins", async () => {
    repository();
    await serve({ JOIN: "no" });
    appendFileSync(feedback, note("N1"));
    expect(await until(() => starts().length === 1, 15_000)).toBe(true);
    // Its claim and the lines given back each start the quiet time again: a retry would come
    // after two quiet times.
    await new Promise((done) => setTimeout(done, 14_000));
    expect(starts()).toHaveLength(1);
    // A new line tries again, with the line given back.
    appendFileSync(feedback, note("N2"));
    expect(await until(() => starts().length === 2, 15_000)).toBe(true);
    expect(starts()[1]?.note).toContain('"line":"N1"');
  }, 60_000);
});
