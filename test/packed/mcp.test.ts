import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";
import TOOLS from "../fixtures/mcp-tools.json" with { type: "json" };

/* `blueline mcp` from the built package, as a harness runs it: the same words as the source. */

const COMMAND = path.join(import.meta.dirname, "..", "..", "dist", "bin", "blueline.js");

describe("the built blueline mcp", () => {
  it("lists the fixture's tools and instructions", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "blueline-mcp-packed-"));
    const client = new Client({ name: "test", version: "1" });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [COMMAND, "mcp", path.join(dir, "feedback.jsonl"), "--wait", "1"],
          cwd: dir,
          stderr: "pipe",
        }),
      );
      expect(client.getInstructions()).toBe(TOOLS.instructions);
      expect((await client.listTools()).tools).toEqual(TOOLS.tools);
      const waited = await client.callTool({ name: "wait_for_feedback", arguments: {} });
      expect(waited.content).toEqual([
        { type: "text", text: "Nothing new. Call wait_for_feedback again to wait more." },
      ]);
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
