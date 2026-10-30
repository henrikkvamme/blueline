# Every line reaches an agent

Status: proposed, 2026-10-30. Revised after review rounds 1 to 3.

ADR 0005 made agents pull their lines, and adapters only wake. The lines are kept in files,
but a line can still wait forever. A message that Henrik spoke in the queue workshop waited
with no agent, and nothing told him. He decided: a line goes through Blueline's channel only
if an agent is sure to take it. Blueline keeps a session for each app that its lines go to.
When that session cannot be reached, a state machine starts a new one.

This follows rat-stack's durability rules (ratstack.sh/skills/durability): accepted intent
lives in storage, one recovery authority decides each next step, every retry reuses the
operation's identity, timeouts come from config, every task has an owner, and durable timers
need recovery.

## Where a line can wait forever today

1. No start adapter is set. Nothing acts until a hook or a listener takes the line
   (`bin/deliver.ts:253`).
2. A start fails. The server waits until a new line changes the file's size
   (`bin/deliver.ts:476`). A T3 thread with no Blueline hooks never joins, so it fails each
   time.
3. An agent says `working` and then dies. `working` makes the claim final, so the line never
   lapses (`bin/claims.ts:141`).
4. An agent stays `busy` after an interrupted turn, or `waiting` after its MCP process was
   killed. While its harness lives, no wake goes out (`src/deliver/wake.ts:46`).
5. A wake or a start never joins. Its reservation stays open, and it blocks every later wake
   (`src/deliver/agents.ts:209`, `src/deliver/wake.ts:43`).
6. `t3 thread show` fails to decode. The thread never counts as ended (`bin/deliver.ts:401`).
7. An orphan `blueline listen` keeps its heartbeat, so the server does nothing
   (`src/deliver/wake.ts:42`).
8. The page's post fails. The page does not send it again.
9. A reply answers a chat, not a line: a line that came after the claim counts as answered
   when the agent replies to an earlier one (`bin/lines.ts:406`, `bin/mcp.ts:91`).
10. A reader expires claims itself (`bin/wire.ts:240`), and a late give-back by the shared
    name `agent` can release a newer claim (`bin/wire.ts:280`).

## The guarantee

Blueline has two kinds of line.

- **An actionable line**: a message, an annotation, a verdict, the last settle, a take-back.
  It ends only when an agent answers it by its line ID. Until then, an owner holds it, and its
  next deadline is in the future.
- **A control line**: a settle that is not the last, or how a walk went. It ends when an
  agent consumes it: the agent received it in a batch, and said so by its line ID. A control
  line never starts a session by itself. It goes with the next delivery to the app's session,
  or with the next wake.

The guarantee holds when one start adapter is available on the machine: T3 Code, `claude` or
`codex`, in that order, unless the app's config names one. With none, the server still keeps
the line, marks it `unrouted`, and the panel says so with the command that fixes it. A line
is never silent.

Delivery is at least once. An agent can act on a line, such as an edit, and die before its
answer is recorded. Its replacement gets the line again with a note: another session held it
from a given time, and its outcome is not known, so check the working tree and the line's chat
before acting. A reply carries a key, so a reply that is sent again is recorded once. The
page applies an agent's acts by line ID and act number, once.

## The record

`feedback.jsonl` stays the record of accepted intent. The page gives each line a UUID, and the
server keeps it: a line with the ID of a line in the file is not appended again, and the
server answers 204 as before.

An append is one step, inside the database's write transaction, so two servers never append
at once:

1. Look for the line's ID. When it is there, answer 204 and stop.
2. When the file does not end with a newline, a crash left a torn line, which was never
   answered: cut the file back to its last newline.
3. Append the line, and sync the file to disk.
4. Insert the line's row, in `sent`, and commit.
5. Answer 204.

So the 204 is the commit. A crash before step 3 ends leaves no line, and the page sends it
again. A crash after it leaves a line with no row, which reconciliation adds.

Everything about delivery is in one SQLite database beside it,
`feedback.jsonl.delivery.sqlite`, in tables: lines, claims, sessions, starts. The lock file
that the readers use today is replaced by this database. Each step is one transaction: a
claim, a give-back, a lapse, a start, a join, an answer. So no step is half written.

The loop reconciles at start and on each sweep: each line in `feedback.jsonl` with no row gets
one, in `sent`. A line is in the record once it is in the file, even when the server died
before its row was written.

## One authority

The server's delivery loop owns every recovery: a lapse, an escalation, a start. Readers
(hooks, `wait_for_feedback`, `listen`) only claim open lines, report progress and give lines
back, each in a transaction, each with the session's ID and the claim's generation. A reader
no longer expires claims. A report with an old generation changes nothing.

Two servers can run for one app on different ports. The database's transactions order their
steps, and each start is reserved in the database first, so two servers never start two
sessions for one need.

## A machine for each line

An XState 6 machine, used through its pure `transition`, as the note machine is. A line's row
holds its state, its generation, its owner and its next deadline. The machine decides; Effect
runs each side effect the decision asks for (a wake, a start, `t3 thread show`), with one
timeout from config and typed errors. The pure-transition pattern needs no `@xstate/effect`.

- `sent`: in the record, offered to nobody yet.
- `offered`: a wake went to the app's session, or a waiting reader was told of it. Deadline:
  a claim within the offer time.
- `claimed`: a session holds it. A session takes its lines in a batch, as ADR 0005 says, and
  the batch has one lease. A report on any line of the batch renews the lease: the session
  works on the batch, one line at a time.
- `working`: the session said that it works on this line, by its ID. A hook or a tool call
  renews nothing; only a report with a line's ID renews.
- Each line also has its own age bound, the longest work time from its claim. A line that
  reaches it unanswered while its session still reports on other lines is not a miss of the
  session: it goes to a second session for the app, and the first session keeps its other
  lines. So a long task does not lose its session, and a forgotten line does not wait for it.
- `starting`: the line waits for the app's start, shared by every line that waits.
- `answered`: an actionable line's end, by a reply that names it.
- `consumed`: a control line's end.
- `unrouted`: no start adapter is available. It goes on when one is.
- `stranded`: the start budget is spent. The panel shows it with Retry, and the loop tries
  again on a slow timer. It is not an end.

A lapse sends the line back to `sent` with a new generation. Only a batch whose lease lapses,
with no report on any of its lines, counts as a miss of its session.

## The app's session

The sessions table names the session that the app's lines go to, by harness and by its T3
thread, Claude session or Codex session, with a generation. The loop offers each line to it
first.

A session counts as reachable only by what it does on lines. Presence alone, such as a
heartbeat of `listen`, or a `busy` or `waiting` state, does not make it reachable.

A session that reports on a line of its batch within the offer time is busy, not gone. An
offer that it does not claim in that time is no miss: the line goes to a second session for
the app, and the first session keeps its batch, its lease and its generation. A miss is only
an offer that a session does not claim while it reports on no line, or a batch whose lease
lapses. After the set number of misses, the loop sends no new line to that session. Its
claims that still report keep their generation until their own lease lapses, so its answers
on them count. A join or a report on a line that it no longer holds changes nothing.

A start is one row, for the app: it is written before the dispatch, with an operation ID, a
generation, a token and a deadline. The token is in the new session's first note, and for T3
the operation ID is in the thread's title too. A start ends when its session joins by its
token, or at its deadline.

A start cannot always be made only once. A start that timed out can still finish after the
loop starts the next one. So Blueline allows a second session, and fences it instead: only a
join with the token of the start row's current generation takes lines. A join with an older
token is refused, and its note tells that agent to end. Each adapter recovers what it can:

- T3: the thread ID is in the answer of `t3 thread create`. When that answer is lost, the loop
  looks for a thread with the operation ID in its title, if the `t3` CLI can list threads;
  else the start's outcome is recorded as not known, and the fence handles a late thread.
- `claude -p` and `codex exec`: the process ID is kept in the start row as soon as the process
  starts. A start whose process is gone and that has not joined has failed. A start whose
  receipt was lost is recorded as not known, and the fence handles it. The start note makes the agent's first action a command that joins
it. `wait_for_feedback` and each `blueline` command join a session, not only a hook, so an
agent with no hooks joins too.

## Time

Each deadline is stored with the step's generation. A sweep runs on a timer, apart from file
changes, and also at start, so a deadline that passed while the server was down acts at once.
A timer that fires for an old generation does nothing. In a running process, a deadline is due
by monotonic time since the step. Across a restart, by wall time. A clock that jumps forward
can end a lease early: the line is delivered again, which at-least-once allows. A clock that
jumps back is caught by the monotonic time.

The times come from the app's config, with defaults: offer 60 s, lease 3 minutes, line
progress 10 minutes, longest work 60 minutes, start join 3 minutes, starts 5 with waits from
30 s to 10 minutes, stranded retry 10 minutes, misses before a new session 2, sweep 5 s.

## The page

The page writes each line to its outbox in storage before it sends it. It sends it again with
a growing wait until the 204, and after a reload it sends each line that was in flight. The
server's ID check makes a second send harmless. The panel shows each actionable line's state:
Sent, With the agent, Starting an agent, No agent yet with Retry, No agent set up with the
command.

## The queue workshop

A spoken message is an actionable line. The workshop reads the agent's replies from the
status file. Two new block kinds carry what the agent does on the page: `walk` (the beats that
the cursor plays) and `act` (the acts on the queue). How a walk went is a control line. The
demo's own `/__agent` route and its Agent SDK session go.

## Tests

- A model test of the line machine and the app's start, over generated event sequences with a
  clock: claims, reports, replies, lapses, deaths, late joins, stale reports, starts with lost
  answers. After each step: an open line has one owner, and a deadline in the future.
- A session with a batch of several long tasks, which reports on the line it works on, keeps
  its session, and each line is answered or moved to a second session at its age bound.
- An append after a torn line: the torn line is cut, the new line reads back whole.
- A start that finishes after its successor: its join is refused, and only one session takes
  lines.
- New lines that arrive while a session works on a long batch go to a second session, and the
  first keeps its batch and its generation, and its answers count.
- Progress properties, under stated assumptions:
  - When a session claims and answers within the times, each actionable line is answered
    within the offer time plus the lease plus the work time.
  - When no session ever answers, each line reaches a new session within a bound, and then
    `stranded`, and a renewal with no progress on that line never holds it.
- Fault injection at each boundary: after the append and before the row; between each
  transaction and its dispatch; a lost 204; a lost start answer; a reader that dies after it
  claimed many lines; two loops on one database; lock contention; a timer that fires across a
  restart; a clock jump each way.
- One test per gap above, which fails before the change. Each property is first checked
  against a planted bug, which it must catch.

## Slices

1. Identity: the page's UUID kept by the server, no second append, the torn line dropped.
2. The record: the SQLite tables, reconciliation, line-ID replies with keys, and readers that
   claim with session and generation and no longer expire. Gaps 9 and 10.
3. The machine and its model and progress tests. Pure, with no I/O.
4. The loop: the sweep, deadlines and their recovery, escalation, gaps 3 to 7.
5. The app's session and its start: the start row, the reconcile by title, the default
   adapters, the join by any command, `unrouted`. Gaps 1, 2 and 6.
6. The page: the outbox in storage and the delivery state in the panel. Gap 8.
7. The workshop on the channel, the `walk` and `act` blocks, the `/__agent` route removed.

Recovery (slice 4) ships only after identity, the record and the fenced readers (slices 1 and
2).

## Not in this decision

- The no-comments rule, which Henrik chose on the same day. Moving the comments out of the
  code and adding the lint rule is its own task, with its own ADR.
- Alchemy. Blueline has no cloud resources.
