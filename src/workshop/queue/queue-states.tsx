import { annotate, arrive, back, next, pick, type Queue } from "../../queue/queue";
import { Status } from "./app";
import { Panel, still, type PanelProps } from "./panel";
import { answerTo, selectorOf, start } from "./script";

/*
 * Every state of the queue's panel side by side, each drawn from a queue as the live
 * workshop has it. Nothing acts here; the live workshop is one tab away.
 */

const walk = (q: Queue, n: number) => {
  let s = q;
  for (let i = 0; i < n; i++) s = next(s).queue;
  return s;
};

const at = 1_000;

const note = (q: Queue, id: string, text: string, target: string, page = "/request") =>
  annotate(q, {
    id,
    page,
    target: selectorOf(target),
    text,
    on: q.trail[q.at],
    at,
  });

const first = walk(start(2), 1);
const choice = walk(start(2), 2);
const picked = pick(choice, "r-status", "Pill");
const question = walk(pick(choice, "r-status", "Pill"), 2);
const annotated = note(first, "a1", "Put the person's name in bold.", "title");
const answered = walk(
  arrive(note(first, "a1", "Put the person's name in bold.", "title"), {
    ...answerTo(
      {
        id: "a1",
        page: "/request",
        target: selectorOf("title"),
        text: "Put the person's name in bold.",
        on: "r-who",
        at,
      },
      at,
    ),
  }),
  1,
);
const twoWait = (() => {
  let q = note(first, "a1", "Put the person's name in bold.", "title");
  q = next(q).queue;
  q = note(q, "a2", "Show the status in words, not only a colour.", "status");
  return q;
})();
const settledBack = back(walk(start(2), 2)).queue;
const allSettled = (() => {
  const q = start(2);
  return { ...q, settled: q.remarks.map((r) => r.id) };
})();

const STATES: readonly { readonly name: string; readonly props: PanelProps }[] = [
  { name: "A remark to look at", props: still(first) },
  { name: "A choice, nothing picked", props: still(choice) },
  { name: "A choice, picked", props: still(picked) },
  { name: "A question", props: still(question) },
  {
    name: "Writing an annotation",
    props: still(first, {
      composer: { target: selectorOf("title"), text: "Put the name in bold" },
    }),
  },
  { name: "Your annotation waits", props: still(annotated, { eta: 6 }) },
  { name: "The agent's answer", props: still(answered) },
  { name: "Held at the limit", props: still(twoWait, { eta: 4 }) },
  { name: "Back on a settled remark", props: still(settledBack) },
  { name: "Settled, with undo", props: still(walk(start(2), 2), { toast: ["r-who"] }) },
  { name: "Two settled at once", props: still(answered, { toast: ["answer-a1", "r-who"] }) },
  { name: "All settled: it ships", props: still(allSettled, { ship: { in: 7 } }) },
  { name: "Merged", props: still(allSettled, { ship: { in: "shipped" } }) },
];

export function QueueStates() {
  return (
    <main className="min-h-screen bg-[#fbfbfc] px-8 pt-20 pb-16 text-[#16161a]">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-[20px] font-semibold">The queue's states</h1>
        <p className="max-w-xl text-[14px] text-[#5b5b66]">
          Each panel is one state, drawn from a queue as the workshop has it. Nothing acts here.{" "}
          <a href="#queue" className="text-[#3550c8] underline">
            Back to the live queue
          </a>
        </p>
      </header>
      <div className="flex flex-wrap items-start gap-6">
        {STATES.map((s) => (
          <figure key={s.name} className="flex flex-col gap-2">
            <figcaption className="text-[12px] font-medium text-[#5b5b66]">{s.name}</figcaption>
            <div className="h-[560px]">
              <Panel {...s.props} preview={(_, v) => <Status look={v} text="In review" />} />
            </div>
          </figure>
        ))}
      </div>
    </main>
  );
}
