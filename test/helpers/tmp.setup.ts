import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/*
 * One temporary folder for a test run. The tests, the servers they start and the commands
 * they run make their folders in it, as `TMPDIR` names it, and the run removes it at the end.
 * A test that fails, or stops before its own clean-up, leaves no folder behind.
 */
export default function setup() {
  const run = realpathSync(mkdtempSync(path.join(tmpdir(), "blueline-test-")));
  process.env.TMPDIR = run;
  return () => {
    stopInside(run);
    rmSync(run, { recursive: true, force: true });
  };
}

/**
 * Stops each process that still works in the folder. A `blueline serve` a test started runs
 * in its state folder, and one that starts after its test stopped the server would run on.
 */
function stopInside(folder: string) {
  let listed = "";
  try {
    listed = execFileSync("lsof", ["-a", "-d", "cwd", "-F", "pn"], { encoding: "utf8" });
  } catch (error) {
    // lsof exits 1 when it cannot read some processes, and still lists the others.
    listed = String(Reflect.get(Object(error), "stdout") ?? "");
  }
  let pid = 0;
  for (const line of listed.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if ((line === `n${folder}` || line.startsWith(`n${folder}/`)) && pid !== process.pid) {
      try {
        process.kill(pid);
      } catch {
        // It ended already.
      }
    }
  }
}
