import type { Agent, Agents, Process } from "./agents.ts";

/*
 * What the server does with the reviewer's lines that no agent took (ADR 0005), without
 * files or a clock, so a test can run it as a table. An agent that works takes its lines
 * itself: by its hooks in a turn, by `wait_for_feedback` while it waits, and by its
 * `blueline wait` when it is idle. The server wakes an idle agent only when its harness can be
 * woken from outside, and starts a fresh one when no joined agent is there, or each one is
 * cold. bin/deliver.ts makes the choice under the agents file's lock, and acts on it.
 */

export type Wake =
  | { readonly kind: "none"; readonly why: string }
  /** Send the lines to an idle session from outside: Codex by `codex queue`, T3 by
   * `t3 thread send`. */
  | { readonly kind: "wake"; readonly session: string; readonly via: "codex" | "t3" }
  | { readonly kind: "start" };

export interface Situation {
  /** The agents whose harness runs, and the open reservations (`liveAgents`). */
  readonly agents: Agents;
  /** Whether a process still runs, for each agent's `waiter`. */
  readonly alive: (process: Process) => boolean;
  /** Whether a listener other than the server's own said it is there just now. */
  readonly listened: boolean;
  readonly now: number;
}

const warm = (agent: Agent, now: number) => now - agent.request <= agent.warm;

/** How the session can be woken from outside, if it can. */
const wayIn = (agent: Agent): "codex" | "t3" | undefined =>
  agent.t3
    ? agent.thread === undefined
      ? undefined
      : "t3"
    : agent.harness === "codex"
      ? "codex"
      : undefined;

export function wakeFor({ agents, alive, listened, now }: Situation): Wake {
  if (listened) return { kind: "none", why: "a listener reads the lines" };
  if (Object.keys(agents.reservations).length > 0)
    return { kind: "none", why: "an agent is starting" };
  const joined = Object.entries(agents.sessions).filter(([, a]) => a.joined);
  if (joined.some(([, a]) => a.state !== "idle"))
    return { kind: "none", why: "a joined agent works, and takes the lines itself" };
  if (joined.some(([, a]) => a.waiter !== undefined && alive(a.waiter) && warm(a, now)))
    return { kind: "none", why: "an idle agent's wait takes the lines" };
  // The newest warm one that can be woken: it has the review's context.
  const woken = joined
    .filter(([, a]) => warm(a, now) && wayIn(a) !== undefined)
    .reduce<[string, Agent] | undefined>(
      (newest, entry) =>
        newest === undefined || entry[1].request > newest[1].request ? entry : newest,
      undefined,
    );
  if (woken !== undefined) {
    const [session, agent] = woken;
    const via = wayIn(agent);
    if (via !== undefined) return { kind: "wake", session, via };
  }
  return { kind: "start" };
}
