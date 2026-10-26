import { describe, expect, inject, it, vi } from "vitest";
import { commands } from "vitest/browser";

/*
 * A script tag by hand, from the built package: a page on its own origin loads the tag from
 * `blueline serve`, the overlay mounts, and the app's channel takes the page's notes.
 */

describe("a script tag by hand", () => {
  const { url, root } = inject("blueline");

  it("mounts the overlay from the server, and the app's channel takes the page's note", async () => {
    const app = await commands.keep(url, root, location.origin);
    const tag = document.createElement("script");
    tag.type = "module";
    tag.src = `${url}${app.base}tag.js`;
    document.head.append(tag);
    await vi.waitFor(() => expect(document.querySelector("blueline-tools")).not.toBeNull(), {
      timeout: 5000,
    });
    expect(window.blueline).toBeDefined();
    const sent = await fetch(`${url}${app.base}feedback`, {
      method: "POST",
      body: JSON.stringify({ kind: "note", text: "From the page" }),
      headers: { "content-type": "application/json" },
    });
    expect(sent.status).toBe(204);
    const notes = await commands.readFile(app.files.feedback);
    expect(notes).toContain("From the page");
    window.blueline?.dispose();
  });
});
