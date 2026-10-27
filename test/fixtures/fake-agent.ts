import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { text } from "node:stream/consumers";

/*
 * An agent that the server starts by the `command` adapter (bin/deliver.ts), for
 * test/deliver-run.test.ts. It reads its note, writes it to OUT, says its process ID in
 * OUT.pid, and, unless JOIN is "no", runs its harness's prompt hook with the note, as a
 * harness does, so it joins by the note's token. Then it stays for HOLD_MS.
 */

const note = await text(process.stdin);
const out = process.env["OUT"] ?? "";
appendFileSync(out, `${JSON.stringify({ pid: process.pid, note })}\n`);
writeFileSync(`${out}.pid`, String(process.pid));
if (process.env["JOIN"] !== "no") {
  const command = path.join(import.meta.dirname, "..", "..", "bin", "blueline.ts");
  spawnSync(
    process.execPath,
    [command, "hook", "claude", "--feedback", process.env["FEEDBACK"] ?? ""],
    {
      input: JSON.stringify({
        session_id: `fake-${String(process.pid)}`,
        cwd: process.cwd(),
        hook_event_name: "UserPromptSubmit",
        prompt: note,
      }),
    },
  );
}
await new Promise((done) => setTimeout(done, Number(process.env["HOLD_MS"] ?? "0")));
