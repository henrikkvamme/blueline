import { describe, expect, it } from "vitest";
import {
  afterBoot,
  backoff,
  due,
  kept,
  spoken,
  spokenAfter,
  withEvent,
  type Spoken,
} from "../src/workshop/queue/spoken";
import { perform } from "../src/workshop/queue/acts";
import { arrive, current, empty, next } from "../src/queue/queue";

const said = (id = "m1", at = 1000) => spoken(id, "Make the title shorter", {}, at);

const through = (m: Spoken, ...events: Parameters<typeof spokenAfter>[1][]) =>
  events.reduce(spokenAfter, m);

describe("a spoken message", () => {
  it("goes from his words to the agent's reply", () => {
    const m = through(
      said(),
      { type: "send" },
      { type: "taken", boot: "b1" },
      { type: "read" },
      { type: "doing", status: "Reading app.tsx" },
    );
    expect(m).toMatchObject({ state: "read", status: "Reading app.tsx", boot: "b1", tries: 1 });
    expect(spokenAfter(m, { type: "replied", text: "Made it shorter" })).toMatchObject({
      state: "replied",
      reply: "Made it shorter",
      status: undefined,
    });
  });

  it("is sent again, with a growing wait, until the server takes it", () => {
    let m = through(said(), { type: "send" }, { type: "refused", at: 2000 });
    expect(m).toMatchObject({ state: "queued", tries: 1, sendAt: 2000 + backoff(1) });
    expect(due([m], 2500)).toEqual([]);
    expect(due([m], 3000)).toEqual([m]);
    m = through(m, { type: "send" }, { type: "refused", at: 3000 });
    expect(m.sendAt).toBe(3000 + backoff(2));
    expect(backoff(2)).toBeGreaterThan(backoff(1));
    expect(backoff(20)).toBe(15_000);
  });

  it("takes the server's events before its answer to the send", () => {
    const m = through(said(), { type: "send" }, { type: "read" });
    expect(m.state).toBe("read");
    expect(spokenAfter(m, { type: "taken", boot: "b1" }).state).toBe("read");
  });

  it("goes back to be sent when the server that took it started again", () => {
    const taken = through(said("m1"), { type: "send" }, { type: "taken", boot: "b1" });
    const read = through(
      said("m2"),
      { type: "send" },
      { type: "taken", boot: "b1" },
      {
        type: "read",
      },
    );
    const sending = through(said("m3"), { type: "send" });
    const done = through(said("m4"), { type: "send" }, { type: "replied", text: "Done" });
    const after = afterBoot([taken, read, sending, done], "b2", 9000);
    expect(after.map((m) => [m.id, m.state, m.sendAt])).toEqual([
      ["m1", "queued", 9000],
      ["m2", "queued", 9000],
      ["m3", "queued", 9000],
      ["m4", "replied", 1000],
    ]);
    // The same server keeps what it took; only a send cut off by a reload goes back.
    expect(afterBoot([taken, read], "b1", 9000).map((m) => m.state)).toEqual(["taken", "read"]);
  });

  it("waits for him after it failed, and goes again when he asks", () => {
    const m = through(said(), { type: "send" }, { type: "failed", why: "The agent stopped" });
    expect(m).toMatchObject({ state: "failed", reply: "The agent stopped" });
    expect(spokenAfter(m, { type: "send" }).state).toBe("failed");
    expect(spokenAfter(m, { type: "retry", at: 5000 })).toMatchObject({
      state: "queued",
      sendAt: 5000,
    });
  });

  it("changes one message of the outbox by its id, and keeps the last that are over", () => {
    const box = [said("m1"), said("m2")];
    expect(withEvent(box, "m2", { type: "send" }).map((m) => m.state)).toEqual([
      "queued",
      "sending",
    ]);
    const over = Array.from({ length: 8 }, (_, i) =>
      through(said(`d${String(i)}`), { type: "send" }, { type: "replied", text: "ok" }),
    );
    const open = said("open");
    expect(kept([...over, open], 5).map((m) => m.id)).toEqual([
      "d3",
      "d4",
      "d5",
      "d6",
      "d7",
      "open",
    ]);
  });
});

describe("the agent's acts", () => {
  const remark = (id: string, more = {}) => ({
    id,
    kind: "look" as const,
    page: "/request",
    target: '[data-q="title"]',
    title: `Remark ${id}`,
    at: 1,
    ...more,
  });
  const start = next([remark("r1"), remark("r2")].reduce(arrive, empty())).queue;

  it("settles, takes the settle back and goes on, as his keys do", () => {
    const settled = perform(start, [], [{ do: "settle" }], 10);
    expect(settled.queue.settled).toEqual(["r1"]);
    expect(current(settled.queue)?.id).toBe("r2");
    expect(settled.toast).toEqual(["r1"]);
    const undone = perform(settled.queue, settled.toast, [{ do: "undo" }], 11);
    expect(undone.queue.settled).toEqual([]);
    expect(undone.said[0]).toContain("took back");
  });

  it("designs variants, adds states and writes a remark", () => {
    const done = perform(
      start,
      [],
      [
        {
          do: "addVariants",
          remark: "r1",
          variants: [{ name: "Bold", html: "<b>{state}</b>" }],
        },
        { do: "addStates", remark: "r1", states: ["Waits for Ingrid Berg"] },
        { do: "keep", value: "Bold", remark: "r1" },
        {
          do: "addRemark",
          open: true,
          remark: { id: "r9", kind: "question", page: "/request", target: "#x", title: "Which?" },
        },
      ],
      42,
    );
    const r1 = done.queue.remarks.find((r) => r.id === "r1");
    expect(r1).toMatchObject({
      kind: "choice",
      variants: ["Bold"],
      designs: { Bold: "<b>{state}</b>" },
      states: ["Waits for Ingrid Berg"],
    });
    expect(done.queue.picks["r1"]).toBe("Bold");
    expect(current(done.queue)?.id).toBe("r9");
    expect(done.said).toHaveLength(4);
  });

  it("says why an act did nothing, and hands the acts that only show to the page", () => {
    const done = perform(
      start,
      [],
      [
        { do: "keep", value: "Nope" },
        { do: "open", remark: "r404" },
        { do: "go", page: "/sent" },
      ],
      1,
    );
    expect(done.queue).toBe(start);
    expect(done.said.slice(0, 2)).toEqual(["“Remark r1” has no “Nope”", "no remark r404"]);
    expect(done.shows).toEqual([{ do: "go", page: "/sent" }]);
  });
});
