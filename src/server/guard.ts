import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";

/*
 * The guard of `blueline dev`'s command (src/server/dev.ts): a small Node process, in a
 * process group of its own, that starts the command in another group and owns it, so no
 * moment is left when the group runs with no one to stop it. On its stdin, `blueline dev`
 * says `go`, then `stop`; on its fourth descriptor, the guard says each thing that happens
 * as one JSON line: `started` with the command's process ID, `failed`, `exit` with the
 * command's code or signal, and `stopped` once no process is left in the group. When its
 * stdin closes before `go`, as when `blueline dev` died, it starts nothing; when it closes
 * after, it stops the group. Stopping sends SIGTERM to the group, waits at most five
 * seconds until it is empty, then sends SIGKILL.
 */

const STOP_MS = 5000;
const KILL_MS = 2000;

interface Given {
  readonly command: readonly string[];
  readonly cwd: string;
  /** What the command's environment adds to the guard's. */
  readonly env: Readonly<Record<string, string>>;
}

const given = JSON.parse(process.argv[2] ?? "{}") as Given;
const said = createWriteStream("", { fd: 3 });
const say = (event: Record<string, unknown>) => said.write(`${JSON.stringify(event)}\n`);

let child: ChildProcess | undefined;
let stopping: Promise<void> | undefined;

/** Whether any process is left in the group. */
const alive = (group: number) => {
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function emptied(group: number, ms: number) {
  for (const until = Date.now() + ms; Date.now() < until; await wait(50))
    if (!alive(group)) return true;
  return !alive(group);
}

function signal(group: number, name: NodeJS.Signals) {
  try {
    process.kill(-group, name);
  } catch {
    // The group is gone already.
  }
}

/** Stops the group, says so and ends the guard. */
function stop() {
  stopping ??= (async () => {
    const group = child?.pid;
    if (group !== undefined) {
      signal(group, "SIGTERM");
      if (!(await emptied(group, STOP_MS))) {
        signal(group, "SIGKILL");
        await emptied(group, KILL_MS);
      }
    }
    say({ stopped: true });
    said.end(() => process.exit(0));
  })();
}

function start() {
  if (child !== undefined || stopping !== undefined) return;
  const [program = "", ...args] = given.command;
  child = spawn(program, args, {
    cwd: given.cwd,
    env: { ...process.env, ...given.env },
    // A group of its own, so it and each process it starts stop together. Its stdin is a
    // pipe that this guard holds open: a terminal would stop a process in another group.
    detached: true,
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.once("spawn", () => say({ started: child?.pid }));
  child.once("error", (error) => {
    say({ failed: error.message });
    stop();
  });
  child.once("exit", (code, signal) => {
    say({ exit: true, code, signal });
    stop();
  });
}

let words = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  words += chunk;
  for (let end = words.indexOf("\n"); end !== -1; end = words.indexOf("\n")) {
    const word = words.slice(0, end);
    words = words.slice(end + 1);
    if (word === "go") start();
    if (word === "stop") stop();
  }
});
// `blueline dev` is gone: with no `go`, nothing starts; after it, the group stops.
process.stdin.once("end", stop);
process.stdin.once("error", stop);
