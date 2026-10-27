import { describe, expect, it } from "vitest";
import {
  afterHook,
  liveAgents,
  mayBlock,
  NO_AGENTS,
  tokenIn,
  tokenLine,
  withStarted,
  type Agent,
  type Agents,
  type Facts,
  type Process,
} from "../src/deliver/agents";
import {
  isOurs,
  mcpTable,
  ourHooks,
  quoted,
  timesFor,
  withMcpTable,
  withOurHooks,
} from "../src/deliver/setup";
import { wakeFor, type Situation } from "../src/deliver/wake";

/*
 * The plain parts of delivery (ADR 0005): an agent's state through its hooks, the server's
 * choice of a wake, and what setup writes. bin/ holds the files; test/deliver-run.test.ts runs
 * them.
 */

const harness: Process = { pid: 100, started: "Tue Oct 27 09:00:00 2026" };
const facts = (session: string, now: number, more: Partial<Facts> = {}): Facts => ({
  session,
  harness: "claude",
  t3: false,
  process: harness,
  warm: 59 * 60_000,
  now,
  ...more,
});

const agent = (more: Partial<Agent> = {}): Agent => ({
  harness: "claude",
  t3: false,
  process: harness,
  state: "idle",
  at: 0,
  joined: true,
  request: 0,
  warm: 59 * 60_000,
  blocks: 0,
  ...more,
});

describe("an agent's state", () => {
  it("is busy from its prompt until its Stop, however long it thinks", () => {
    let agents = afterHook(NO_AGENTS, "start", facts("s", 1));
    expect(agents.sessions["s"]?.state).toBe("idle");
    agents = afterHook(agents, "prompt", facts("s", 2));
    expect(agents.sessions["s"]?.state).toBe("busy");
    // No hook for minutes: nothing but its Stop makes it idle.
    agents = afterHook(agents, "tool", facts("s", 3 * 60_000));
    expect(agents.sessions["s"]?.state).toBe("busy");
    agents = afterHook(agents, "stop", facts("s", 3 * 60_000 + 1));
    expect(agents.sessions["s"]?.state).toBe("idle");
    expect(afterHook(agents, "end", facts("s", 5)).sessions["s"]).toBeUndefined();
  });

  it("joins by a blueline command, or by the token of a reservation in its prompt", () => {
    let agents = afterHook(NO_AGENTS, "prompt", facts("s", 1));
    expect(agents.sessions["s"]?.joined).toBe(false);
    agents = afterHook(agents, "tool", facts("s", 2), { joins: true });
    expect(agents.sessions["s"]?.joined).toBe(true);

    const reserved: Agents = {
      sessions: {},
      reservations: { abc12345: { adapter: "t3", thread: "T1", lines: ["L1"], at: 1 } },
    };
    const joined = afterHook(reserved, "prompt", facts("new", 2), { token: "abc12345" });
    expect(joined.sessions["new"]).toMatchObject({ joined: true, thread: "T1", state: "busy" });
    expect(joined.reservations).toEqual({});
    // A token with no reservation joins nothing.
    expect(
      afterHook(NO_AGENTS, "prompt", facts("x", 2), { token: "zzzz9999" }).sessions["x"]?.joined,
    ).toBe(false);
  });

  it("reads the token from the fixed line", () => {
    expect(tokenIn(`${tokenLine("0a1b2c3d4e5f")}\nThe rest`)).toBe("0a1b2c3d4e5f");
    expect(tokenIn("No token here")).toBeUndefined();
  });

  it("counts its Stop blocks in a row, so the last one the harness allows is the last", () => {
    let agents = afterHook(NO_AGENTS, "prompt", facts("s", 1), { joins: true });
    for (let i = 0; i < 8; i += 1) {
      expect(mayBlock(agents.sessions["s"], 8)).toBe(true);
      agents = afterHook(agents, "stop", facts("s", 2 + i), { blocked: true });
    }
    // The ninth would be overridden: the hook claims nothing and lets the session go idle.
    expect(mayBlock(agents.sessions["s"], 8)).toBe(false);
    expect(agents.sessions["s"]?.state).toBe("busy");
    // A tool batch starts the count again.
    agents = afterHook(agents, "tool", facts("s", 20));
    expect(mayBlock(agents.sessions["s"], 8)).toBe(true);
    // A session that did not join is never blocked.
    expect(mayBlock(agent({ joined: false }), 8)).toBe(false);
  });

  it("counts a Stop block from the session's count in all its files", () => {
    const one = afterHook(NO_AGENTS, "tool", facts("s", 1), { joins: true });
    const after = afterHook(one, "stop", facts("s", 2), { blocked: true, before: 5 });
    expect(after.sessions["s"]?.blocks).toBe(6);
  });

  it("gives a thread that a start returns after its agent joined to the session", () => {
    const reserved: Agents = {
      sessions: {},
      reservations: { abc12345: { adapter: "t3", lines: [], at: 1 } },
    };
    // The prompt hook joins by the token before `t3 thread start` returns.
    const joined = afterHook(reserved, "prompt", facts("new", 2), { token: "abc12345" });
    expect(withStarted(joined, "abc12345", { thread: "T9" }).sessions["new"]?.thread).toBe("T9");
    // Before the join, the reservation keeps it.
    expect(
      withStarted(reserved, "abc12345", { thread: "T9" }).reservations["abc12345"]?.thread,
    ).toBe("T9");
  });

  it("is a new agent in a new harness process, even with the same session", () => {
    const joined = afterHook(NO_AGENTS, "tool", facts("s", 1), { joins: true });
    const other = { pid: 200, started: "Tue Oct 27 10:00:00 2026" };
    expect(
      afterHook(joined, "start", facts("s", 2, { process: other })).sessions["s"]?.joined,
    ).toBe(false);
  });

  it("is gone once its harness no longer runs, and so is a reservation that cannot join", () => {
    const gone: Process = { pid: 300, started: "Tue Oct 27 08:00:00 2026" };
    const agents: Agents = {
      sessions: { live: agent(), dead: agent({ process: gone }) },
      reservations: {
        start: { adapter: "claude", process: gone, lines: [], at: 0 },
        wake: { adapter: "codex", session: "dead", lines: [], at: 0 },
        sent: { adapter: "codex", session: "live", lines: [], at: 0 },
        thread: { adapter: "t3", thread: "T", lines: [], at: 0 },
      },
    };
    const live = liveAgents(agents, (p) => p.pid === harness.pid);
    expect(Object.keys(live.sessions)).toEqual(["live"]);
    expect(Object.keys(live.reservations).sort()).toEqual(["sent", "thread"]);
  });
});

describe("the server's wake", () => {
  const now = 10 * 60_000;
  const situation = (agents: Agents, more: Partial<Situation> = {}): Situation => ({
    agents,
    alive: () => true,
    listened: false,
    now,
    ...more,
  });
  const only = (a: Agent): Agents => ({ sessions: { s: a }, reservations: {} });

  it.each([
    ["a listener runs", NO_AGENTS, { listened: true }, "none"],
    [
      "an agent is starting",
      { sessions: {}, reservations: { t: { adapter: "t3", lines: [], at: 0 } } },
      {},
      "none",
    ],
    ["a joined agent is busy", only(agent({ state: "busy" })), {}, "none"],
    ["a joined agent waits on wait_for_feedback", only(agent({ state: "waiting" })), {}, "none"],
    ["an idle agent's wait runs", only(agent({ waiter: harness, request: now })), {}, "none"],
    ["an idle Codex agent is warm", only(agent({ harness: "codex", request: now })), {}, "wake"],
    ["an idle T3 thread is warm", only(agent({ t3: true, thread: "T", request: now })), {}, "wake"],
    ["an idle Claude agent has no wait", only(agent({ request: now })), {}, "start"],
    [
      "an idle Codex agent is cold",
      only(agent({ harness: "codex", request: 0, warm: 60_000 })),
      {},
      "start",
    ],
    ["the only agent did not join", only(agent({ joined: false, state: "busy" })), {}, "start"],
    ["there is no agent", NO_AGENTS, {}, "start"],
  ] as const)("when %s: %s", (_, agents, more, kind) => {
    expect(wakeFor(situation(agents, more)).kind).toBe(kind);
  });

  it("wakes the newest warm agent that it can reach", () => {
    const agents: Agents = {
      sessions: {
        old: agent({ harness: "codex", request: now - 60_000 }),
        new: agent({ harness: "codex", request: now }),
      },
      reservations: {},
    };
    expect(wakeFor(situation(agents))).toEqual({ kind: "wake", session: "new", via: "codex" });
  });

  it("starts a fresh agent when the idle agent's wait is gone", () => {
    const waiter: Process = { pid: 9, started: "x" };
    const agents = only(agent({ waiter, request: now }));
    expect(wakeFor(situation(agents, { alive: (p) => p.pid !== 9 })).kind).toBe("start");
  });
});

describe("setup", () => {
  it.each([
    [5, { warmMinutes: 4, waitSeconds: 240, waitHookSeconds: 300, toolTimeoutSeconds: 250 }],
    [30, { warmMinutes: 29, waitSeconds: 1740, waitHookSeconds: 1800, toolTimeoutSeconds: 1750 }],
    [60, { warmMinutes: 59, waitSeconds: 3540, waitHookSeconds: 3600, toolTimeoutSeconds: 3550 }],
  ])("takes every time from a %i-minute cache", (cache, times) => {
    expect(timesFor(cache)).toEqual(times);
  });

  const options = {
    invocation: { command: "/usr/bin/node", prefix: ["/x/bin/blueline.ts"] },
    name: "agent",
    feedback: undefined,
    times: timesFor(60),
  } as const;

  it("adds Claude's hooks and its idle wait, and keeps the hooks it does not own", () => {
    const theirs = { type: "command", command: "/their/lint.sh" } as const;
    const before = {
      Stop: [{ hooks: [theirs] }],
      PostToolUse: [{ matcher: "Edit", hooks: [theirs] }],
    };
    const ours = ourHooks({ ...options, harness: "claude" });
    const after = withOurHooks(before, ours);
    expect(Object.keys(after).sort()).toEqual([
      "PostToolBatch",
      "PostToolUse",
      "SessionEnd",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
    expect(after["PostToolUse"]).toEqual(before.PostToolUse);
    const stop = after["Stop"]?.flatMap((g) => g.hooks) ?? [];
    expect(stop[0]).toEqual(theirs);
    expect(stop.slice(1)).toEqual([
      {
        type: "command",
        command: "/usr/bin/node",
        args: ["/x/bin/blueline.ts", "hook", "claude", "--warm", "59"],
      },
      {
        type: "command",
        command: "/usr/bin/node",
        args: ["/x/bin/blueline.ts", "wait"],
        asyncRewake: true,
        timeout: 3600,
      },
    ]);
    // Again, the same; and taken out, as before.
    expect(withOurHooks(after, ours)).toEqual(after);
    expect(withOurHooks(after, {})).toEqual(before);
  });

  it("gives Codex one command line for each hook", () => {
    const ours = ourHooks({
      ...options,
      harness: "codex",
      name: "review",
      feedback: "/a b/f.jsonl",
    });
    expect(ours["PostToolUse"]).toEqual([
      {
        type: "command",
        command:
          "/usr/bin/node /x/bin/blueline.ts hook codex --warm 59 --as review --feedback '/a b/f.jsonl'",
      },
    ]);
    expect(ours["Stop"]).toHaveLength(1);
    expect(isOurs({ type: "command", command: "/opt/blueline/bin/blueline hook codex" })).toBe(
      true,
    );
    expect(isOurs({ type: "command", command: "blueline-lint --hook x" })).toBe(false);
    expect(quoted("it's")).toBe(`'it'\\''s'`);
  });

  it("writes Codex's MCP table in place of the one it had, and keeps the others", () => {
    const table = mcpTable("/usr/bin/node", ["/x/blueline.ts", "mcp", "/f.jsonl"], timesFor(30));
    const toml = 'model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n';
    const once = withMcpTable(toml, table);
    expect(once).toBe(
      `${toml}\n[mcp_servers.blueline]\ncommand = "/usr/bin/node"\nargs = ["/x/blueline.ts", "mcp", "/f.jsonl"]\ntool_timeout_sec = 1750\n`,
    );
    expect(withMcpTable(once, table)).toBe(once);
    expect(withMcpTable(once, undefined)).toBe(toml);
  });

  it.each([
    "[mcp_servers.blueline] # mine",
    '[ mcp_servers."blueline" ]',
    "[mcp_servers . 'blueline']",
  ])("finds its table by the header %s", (header) => {
    const table = mcpTable("/usr/bin/node", ["/x/blueline.ts"], timesFor(30));
    const toml = `${header}\ncommand = "old"\n\n[mcp_servers.other]\ncommand = "o"\n`;
    const written = withMcpTable(toml, table);
    expect(written).not.toContain('"old"');
    expect(written.match(/blueline/g)).toHaveLength(2);
  });
});
