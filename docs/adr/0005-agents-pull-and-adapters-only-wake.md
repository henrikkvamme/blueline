# Agents pull, and adapters only wake

ADR 0003 made the server push each note into an agent. A push into a busy agent either
waits for the turn to end or breaks into it, and each harness does that in its own way. A
push also adds text that the agent did not ask for, at a time it did not choose, which
costs prompt cache. Now an agent that works takes its notes itself, and an adapter only
wakes an agent that is idle or absent.

- **An agent in a turn** gets new lines from its harness hooks. In Claude Code, a
  `PostToolBatch` hook adds them as `additionalContext` before the next model call; in
  Codex, a `PostToolUse` hook does. A `Stop` hook blocks the end of the turn while new
  lines wait. A hook with nothing new prints nothing.
- **An agent that waits** calls `wait_for_feedback` on `blueline mcp`. The call blocks
  until a line arrives or its cap ends. The cap is the smaller of the client's tool timeout
  less 10 s and the cache lifetime less 60 s: about 4 minutes for a 5-minute cache, and
  about 50 minutes for a 1-hour cache. `blueline setup codex` raises Codex's
  `tool_timeout_sec` (60 s by default) to fit. Claude Code moves a call that runs for more
  than 2 minutes to a background task, and its result comes back as a task notification.
  That is enough.
- **An idle agent** is woken by its adapter. `claude`: an `asyncRewake` hook runs
  `blueline wait`, which exits 2 when a line arrives. `codex`: `codex queue` or `turn/start`
  through the shared app-server daemon, never a second server for a loaded thread. `t3`:
  `t3 thread send`, which queues the line as the next turn. `command`: any command, with the
  lines on its input.
- **With no agent**, the adapter starts a fresh session with a short note that stands alone:
  the page, the open lines, the last decision and the file paths. It never resumes a
  session that another process holds, because two writers interleave one transcript.

An agent registers when its hook runs or when it calls `wait_for_feedback`, by its session
ID, in `.blueline/agents.json`. Each hook records the process ID of its harness, its parent process. The agent is `busy`
from `UserPromptSubmit` until its `Stop` hook lets the turn end, however long the model
thinks between hooks; `waiting` during a call; and `idle` after `Stop`. It is gone after
`SessionEnd`, or as soon as its harness process no longer runs, as when it was killed in a
turn; then its lines go to a wake. No timer decides that an agent is gone. A line goes to one agent: the claim is atomic under the feedback file's lock (slice
W0), so a pull and a wake never both take a line.

`blueline setup <harness>` adds the MCP server and the hooks for one harness. That is an
install, which ADR 0002 ruled out. ADR 0002 named the case that would change it: a session
that is not under T3 got notes only while a watcher ran, and the watcher expired. Notes
still carry their own instructions, so a harness with no setup still works through
`blueline listen` or the `command` adapter.

## Cache rules

- Only add text after the last message. Never rewrite an earlier hook output or result.
- The MCP tool list, its order, its descriptions and the server's instructions never
  change. They hold no counts, times or state, and the server never sends
  `tools/list_changed`. State goes in tool results.
- Add text only when there is something new. An empty poll returns one short fixed line.
- Batch: one hook output or poll result carries every line since the reader's cursor.
- Resume a session when its last request is within the cache lifetime, or when its context
  is small, under about three times its system prompt. Otherwise start fresh with the
  short note. `status.json` keeps each agent's last request time for this choice.

A cold resume of a 150k-token session costs about 1.25 to 2 times its whole context. A fresh
session costs only its system prompt, its tools and the note.

## Consequences

The server still keeps the lines, serves the page and runs the adapters, as ADR 0003 says;
it no longer pushes into a running agent. Claude Code channels are not the wake path: they
are a research preview, need a development flag for a custom server, and do not reach a
busy session. Slice C2 must show that an `asyncRewake` hook wakes an idle interactive
session before the launchd service retires. If it does not, the `claude` adapter starts a
fresh session.
