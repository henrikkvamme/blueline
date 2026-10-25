import { CircleCheck } from "lucide-react";
import type { Note } from "../notes/note";
import { useNotes, useSession, useStep, useTools } from "./session";

/*
 * The finish, in the panel in place of the step, once every step of the journey is settled:
 * how many steps, the variant kept of each part, and how many notes went to the agent. The
 * review ends only when the reviewer finishes it; the last settle waits until then, so the
 * agent wakes once. Back opens the last step again, as Escape and u do.
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
  return (
    <section
      aria-label="Finish the review"
      className="flex shrink-0 flex-col gap-3 px-4 pt-3.5 pb-4 max-sm:gap-4"
    >
      <h2 className="flex items-center gap-2 text-[14px] leading-5 font-semibold max-sm:text-[16px]">
        <CircleCheck className="size-4 shrink-0 text-dt-good" aria-hidden />
        All {steps.length} steps settled
      </h2>
      {kept.size > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-5 max-sm:text-[15px] max-sm:leading-6">
          {[...kept].map(([part, variant]) => (
            <div key={part} className="contents">
              <dt className="text-dt-muted">{part}</dt>
              <dd className="min-w-0 truncate">{variant}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-[12px] text-dt-muted tabular-nums max-sm:text-[14px]">
        {sent === 1 ? "1 note sent" : `${String(sent)} notes sent`}
      </p>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => perform({ kind: "event", event: { type: "back" } })}
          className="h-8 rounded-dt-control px-3 text-[12px] text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:px-4 max-sm:text-[15px]"
        >
          Back
        </button>
        <button
          type="button"
          data-dt-finish=""
          onClick={() => perform({ kind: "event", event: { type: "finish" } })}
          className="h-8 rounded-dt-control bg-dt-accent px-3 text-[12px] font-medium text-white hover:bg-dt-accent/85 max-sm:h-11 max-sm:px-4 max-sm:text-[15px]"
        >
          Finish review
        </button>
      </div>
    </section>
  );
}
