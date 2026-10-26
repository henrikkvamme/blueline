import { ChevronLeft, Send } from "lucide-react";
import { isListened } from "../io/listening";
import { handoffJourney } from "../notes/handoff";
import type { Note } from "../notes/note";
import { Blocks } from "./blocks";
import { allSettled } from "./progress";
import { Thread } from "./composer";
import { cx } from "./cx";
import { useNotes, useSession, useStep, useTools } from "./session";
import { Sending, usePending } from "./sending";
import { Foot, KEEP_FOCUS } from "./step-controls";

/*
 * The finish, in the panel in place of the step, once every step of the journey is settled:
 * how many steps, the variant kept of each part, and how many notes went to the agent. The
 * review ends only when the reviewer finishes it; the last settle waits until then, so the
 * agent wakes once. The foot holds Back, which opens the last step again as Escape and u do,
 * in the place of the step before, and Finish review in the place of Settle. Once finished,
 * the hand-off takes its place: the same rows, and what the agent does with the review. For
 * the first seconds it says "Sending to the agent", with Undo, which shows the finish again.
 */

/** The notes the reviewer sent on these steps: each pointed note, and each message with
 * words alone. */
const sentOn = (notes: readonly Note[], steps: ReadonlySet<string>) =>
  notes
    .filter((n) => steps.has(n.step))
    .flatMap((n) => n.thread)
    .filter((m) => m.by === "you")
    .reduce((count, m) => count + Math.max(m.pins?.length ?? 0, m.text.trim() === "" ? 0 : 1), 0);

/** What the review kept and sent, as rows: the variant kept of each part, and the notes sent.
 * The finish and the hand-off show the same rows in the same place. */
function Summary({ steps }: { readonly steps: readonly { readonly id: string }[] }) {
  const feedback = useSession((s) => s.context.feedback);
  const notes = useNotes();
  // Each part once, with the variant its last verdict kept.
  const kept = new Map<string, string>();
  for (const step of steps)
    for (const [part, verdicts] of Object.entries(feedback[step.id]?.parts ?? {})) {
      const variant = verdicts.kept.at(-1);
      if (variant !== undefined) kept.set(part, variant);
    }
  const sent = sentOn(notes, new Set(steps.map((s) => s.id)));
  const row =
    "flex items-baseline justify-between gap-3 border-t border-dt-line py-2.5 first:border-t-0";
  return (
    <dl className="mt-5 flex flex-col text-[13px] max-sm:text-[15px]">
      {[...kept].map(([part, variant]) => (
        <div key={part} className={row}>
          <dt className="min-w-0 truncate text-dt-muted">{part}</dt>
          <dd className="min-w-0 truncate font-medium">{variant}</dd>
        </div>
      ))}
      <div className={row}>
        <dt className="text-dt-muted">Notes sent</dt>
        <dd className="font-medium tabular-nums">{sent}</dd>
      </div>
    </dl>
  );
}

/** The top of the finish and the hand-off: a green Settled, the title and one muted line. */
function Head({ title, line }: { readonly title: string; readonly line: string }) {
  return (
    <>
      <span className="self-start rounded-full bg-dt-good/15 px-2 py-0.5 text-[12px] text-dt-good">
        Settled
      </span>
      <h2 className="mt-2.5 text-[21px] leading-7 font-semibold tracking-[-0.01em] text-dt-text tabular-nums">
        {title}
      </h2>
      <p className="mt-2 text-[14px] leading-[1.55] text-dt-muted tabular-nums">{line}</p>
    </>
  );
}

const BODY =
  "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-6 pb-4 max-sm:pt-2 max-sm:flex-initial";

export function FinishView() {
  const { perform } = useTools();
  const { journey } = useStep();
  const steps = journey?.steps ?? [];
  return (
    <section
      aria-label="Finish the review"
      className="flex min-h-0 flex-1 flex-col max-sm:flex-initial"
    >
      <div className={BODY}>
        <Head title={allSettled(steps.length)} line="Finish to send the review to the agent." />
        <Summary steps={steps} />
      </div>
      <Foot>
        <button
          type="button"
          {...KEEP_FOCUS}
          aria-label="Back to the last step"
          title="Back to the last step"
          onClick={() => perform({ kind: "event", event: { type: "back" } })}
          className="grid size-10 shrink-0 place-items-center rounded-dt-control bg-dt-raised text-dt-muted hover:bg-dt-line hover:text-dt-text max-sm:size-11"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          {...KEEP_FOCUS}
          data-dt-finish=""
          onClick={() => perform({ kind: "event", event: { type: "finish" } })}
          className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-dt-control bg-dt-accent text-[14px] font-medium text-white hover:bg-dt-accent/85 max-sm:h-11 max-sm:text-[15px]"
        >
          <Send className="size-4 shrink-0" aria-hidden />
          Finish review
        </button>
      </Foot>
    </section>
  );
}

/**
 * The hand-off, in the panel in place of the finish once the reviewer finished: the review
 * went to the agent, with the same rows as the finish, and under them what the agent does with
 * it. First a quiet wait; then, as the agent works, its plan, which changes in place; then its
 * reply, as a chat shows one. Done, or Escape, leaves it for the tree. A reload keeps it.
 */
export function HandoffView({ note }: { readonly note: Note }) {
  const { actor, adapter } = useTools();
  const journeyId = handoffJourney(note.step) ?? "";
  const journey = adapter.journeys.find((j) => j.id === journeyId);
  const steps = journey?.steps ?? [];
  // The Finish waits before it goes: Undo shows the finish again.
  const pending = usePending({ handoff: note.id });
  const title = pending === undefined ? "Sent to the agent" : "Sending to the agent";
  return (
    <section aria-label={title} className="flex min-h-0 flex-1 flex-col max-sm:flex-initial">
      <div className={BODY}>
        <Head title={title} line={`${allSettled(steps.length)}.`} />
        <Summary steps={steps} />
        {pending === undefined ? (
          <AgentAnswer note={note} journey={journeyId} />
        ) : (
          <Sending pending={pending} className="mt-6" />
        )}
      </div>
      <Foot>
        <button
          type="button"
          {...KEEP_FOCUS}
          onClick={() => actor.send({ type: "handoff", id: null })}
          className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-dt-control bg-dt-raised text-[14px] text-dt-muted hover:bg-dt-line hover:text-dt-text max-sm:h-11 max-sm:text-[15px]"
        >
          Done
        </button>
      </Foot>
    </section>
  );
}

/** Where the agent is with the review: a wait, its plan while it works, then its reply. A
 * review that no agent listens for says so, as it would wait for nothing. */
function AgentAnswer({ note, journey }: { readonly note: Note; readonly journey: string }) {
  const unheard = useSession((s) => isListened(s.context.listened, journey) === false);
  const working = note.state === "working";
  const said = note.thread.some((m) => m.by === "agent");
  return (
    <section aria-label="The agent" className="mt-6 flex flex-col gap-2.5">
      {!said && (
        <span className="flex h-5 items-center gap-2 text-[13px] text-dt-muted">
          <i
            aria-hidden
            className={cx(
              "size-1.5 shrink-0 rounded-full",
              unheard && !working
                ? "bg-dt-faint"
                : "bg-dt-accent animate-pulse motion-reduce:animate-none",
            )}
          />
          {working
            ? "The agent is working"
            : unheard
              ? "Sent, but no agent listens"
              : "Waiting for the agent"}
        </span>
      )}
      {working && note.progress !== undefined && note.progress.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Blocks blocks={note.progress} note={note} after={[]} />
        </div>
      )}
      {said && <Thread note={note} className="" />}
    </section>
  );
}
