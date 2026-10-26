import { ChevronLeft, Send } from "lucide-react";
import type { Note } from "../notes/note";
import { useNotes, useSession, useStep, useTools } from "./session";
import { Foot, KEEP_FOCUS } from "./step-controls";

/*
 * The finish, in the panel in place of the step, once every step of the journey is settled:
 * how many steps, the variant kept of each part, and how many notes went to the agent. The
 * review ends only when the reviewer finishes it; the last settle waits until then, so the
 * agent wakes once. The foot holds Back, which opens the last step again as Escape and u do,
 * in the place of the step before, and Finish review in the place of Settle.
 */

/** The notes the reviewer sent on these steps: each pointed note, and each message with
 * words alone. */
const sentOn = (notes: readonly Note[], steps: ReadonlySet<string>) =>
  notes
    .filter((n) => steps.has(n.step))
    .flatMap((n) => n.thread)
    .filter((m) => m.by === "you")
    .reduce((count, m) => count + Math.max(m.pins?.length ?? 0, m.text.trim() === "" ? 0 : 1), 0);

export function FinishView() {
  const { perform } = useTools();
  const { journey } = useStep();
  const feedback = useSession((s) => s.context.feedback);
  const notes = useNotes();
  const steps = journey?.steps ?? [];
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
    <section
      aria-label="Finish the review"
      className="flex min-h-0 flex-1 flex-col max-sm:flex-initial"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-6 pb-4 max-sm:pt-2 max-sm:flex-initial">
        <span className="self-start rounded-full bg-dt-good/15 px-2 py-0.5 text-[12px] text-dt-good">
          Settled
        </span>
        <h2 className="mt-2.5 text-[21px] leading-7 font-semibold tracking-[-0.01em] text-dt-text tabular-nums">
          All {steps.length} steps settled
        </h2>
        <p className="mt-2 text-[14px] leading-[1.55] text-dt-muted">
          Finish to send the review to the agent.
        </p>
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
