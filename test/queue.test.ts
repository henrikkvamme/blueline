import { describe, expect, it } from "vitest";
import {
  annotate,
  ahead,
  arrive,
  back,
  current,
  done,
  empty,
  left,
  next,
  pick,
  settleNow,
  seen,
  show,
  unsettle,
  type Annotation,
  type Queue,
  type Remark,
} from "../src/queue/queue";

const look = (id: string, page: string, at: number): Remark => ({
  id,
  kind: "look",
  page,
  target: `#${id}`,
  title: id,
  at,
});

const answer = (id: string, to: string, page: string, at: number): Remark => ({
  id,
  kind: "answer",
  page,
  target: `#${id}`,
  title: id,
  answers: [to],
  at,
});

const note = (id: string, on: string | undefined, page = "/a"): Annotation => ({
  id,
  page,
  target: "#x",
  text: id,
  on,
  at: 0,
});

const start = (...remarks: readonly Remark[]): Queue =>
  remarks.reduce((q, r) => arrive(q, r), empty());

const go = (q: Queue, ...moves: readonly ((q: Queue) => { readonly queue: Queue })[]) =>
  moves.reduce((s, m) => m(s).queue, q);

describe("the queue", () => {
  it("shows the remarks in the agent's order, and settles each one left with no annotation", () => {
    let q = start(look("a", "/a", 1), look("b", "/a", 2));
    q = go(q, next);
    expect(current(q)?.id).toBe("a");
    const moved = next(q);
    expect(moved.settled).toEqual(["a"]);
    expect(current(moved.queue)?.id).toBe("b");
    expect(left(moved.queue)).toBe(1);
  });

  it("skips settled remarks on Next, and Back still shows them", () => {
    let q = start(look("a", "/a", 1), look("b", "/a", 2), look("c", "/a", 3));
    q = { ...q, settled: ["b"] };
    q = go(q, next, next);
    expect(current(q)?.id).toBe("c");
    q = go(q, back);
    expect(current(q)?.id).toBe("a");
  });

  it("finishes the page that shows before it goes to another", () => {
    let q = start(look("a", "/a", 1), look("b", "/b", 2), look("c", "/a", 3));
    q = go(q, next, next);
    expect(current(q)?.id).toBe("c");
  });

  it("takes an answer before a new remark, the oldest first", () => {
    let q = start(look("a", "/a", 1), look("b", "/b", 2));
    q = go(q, next);
    q = annotate(q, note("n1", "a"));
    q = arrive(q, answer("r1", "n1", "/b", 5));
    q = go(q, next);
    expect(current(q)?.id).toBe("r1");
  });

  it("puts an annotated remark back in the queue where its answer comes", () => {
    let q = start(look("a", "/a", 1), look("b", "/a", 2), look("c", "/b", 3));
    q = go(q, next);
    q = annotate(q, note("n1", "a"));
    q = go(q, next);
    expect(current(q)?.id).toBe("b");
    // The answer to come stands before new remarks on another page.
    expect(ahead(q).map((x) => (x.kind === "remark" ? x.remark.id : x.annotation.id))).toEqual([
      "n1",
      "c",
    ]);
    q = arrive(q, answer("r1", "n1", "/a", 9));
    expect(ahead(q).map((x) => (x.kind === "remark" ? x.remark.id : x.annotation.id))).toEqual([
      "r1",
      "c",
    ]);
  });

  it("lists the remarks seen before, and Next goes on from the past to what is open", () => {
    let q = start(look("a", "/a", 1), look("b", "/a", 2), look("c", "/a", 3));
    q = go(q, next, next);
    expect(seen(q).map((r) => r.id)).toEqual(["a"]);
    q = go(q, (s) => show(s, "a"));
    expect(current(q)?.id).toBe("a");
    // a and b are settled: Next passes over them, to the first open remark.
    q = go(q, next);
    expect(current(q)?.id).toBe("c");
  });

  it("settles an annotated remark once the answers to it settle", () => {
    let q = start(look("a", "/a", 1));
    q = go(q, next);
    q = annotate(q, note("n1", "a"));
    const left1 = next(q);
    expect(left1.settled).toEqual([]);
    q = arrive(left1.queue, answer("r1", "n1", "/a", 5));
    q = go(q, next);
    expect(current(q)?.id).toBe("r1");
    const end = next(q);
    expect(end.settled).toEqual(["r1", "a"]);
    expect(done(end.queue)).toBe(true);
  });

  it("keeps an answer open when he annotates it again, until the second answer settles", () => {
    let q = start(look("a", "/a", 1));
    q = go(q, next);
    q = annotate(q, note("n1", "a"));
    q = arrive(q, answer("r1", "n1", "/a", 5));
    q = go(q, next);
    q = annotate(q, note("n2", "r1"));
    q = arrive(q, answer("r2", "n2", "/a", 6));
    const moved = next(q);
    expect(moved.settled).toEqual([]);
    expect(current(moved.queue)?.id).toBe("r2");
    expect(next(moved.queue).settled).toEqual(["r2", "r1", "a"]);
  });

  it("does not settle a choice or a question with no pick", () => {
    let q = start(
      { ...look("c", "/a", 1), kind: "choice", variants: ["One", "Two"] },
      look("d", "/a", 2),
    );
    q = go(q, next);
    expect(next(q).settled).toEqual([]);
    q = pick(q, "c", "Two");
    expect(next(q).settled).toEqual(["c"]);
  });

  it("settles at once, goes on, and undo takes it back", () => {
    let q = start(look("a", "/a", 1), look("b", "/a", 2));
    q = go(q, next);
    const moved = settleNow(q);
    expect(moved.settled).toEqual(["a"]);
    expect(current(moved.queue)?.id).toBe("b");
    expect(unsettle(moved.queue, moved.settled).settled).toEqual([]);
  });

  it("shows a remark from its pin, and Back returns to the one before", () => {
    let q = start(look("a", "/a", 1), look("b", "/a", 2), look("c", "/a", 3));
    q = go(q, next, (s) => show(s, "c"));
    expect(current(q)?.id).toBe("c");
    q = go(q, back);
    expect(current(q)?.id).toBe("a");
  });
});
