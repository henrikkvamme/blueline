import { Check, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { useSyncExternalStore } from "react";
import { NO_VERDICTS, partOn, parts, variantOf, varietyOf } from "../part/store";
import { cx } from "./cx";
import { useSession, useStep, useTools, useVariant } from "./session";

/*
 * The step's own controls, which the panel's step header and the bar, its folded form, both
 * show: the step before and after, Settle, which variant the page shows, and the lift.
 */

/** What the step has to lift with v: how many of its part's variants or states, or of the
 * step's own states, which its `variants` set up on the page; none when it has nothing. */
export function useVariety():
  | { readonly count: number; readonly kind: "variants" | "states" }
  | undefined {
  const { journey, step } = useStep();
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  if (step === undefined) return undefined;
  const part = partOn(step, journey);
  const variety =
    part === undefined ? undefined : varietyOf(part, now.verdicts[part.name] ?? NO_VERDICTS);
  if (variety !== undefined)
    return variety.variants > 1
      ? { count: variety.variants, kind: "variants" }
      : { count: variety.states + 1, kind: "states" };
  const own = step.variants?.length ?? 0;
  return own > 1 ? { count: own, kind: "states" } : undefined;
}

/** Which variant the step shows, of how many: its part's variants, else the step's own. */
export function useVariantPlace():
  | { readonly at: number; readonly of: number; readonly label: string }
  | undefined {
  const { journey, step } = useStep();
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  const own = useVariant(step);
  if (step === undefined) return undefined;
  const part = partOn(step, journey);
  if (part !== undefined) {
    const verdicts = now.verdicts[part.name] ?? NO_VERDICTS;
    const left = part.labels.filter((l) => !verdicts.dropped.includes(l));
    if (left.length > 1) {
      const label = variantOf(
        part.labels,
        now.shown[part.name] ?? parts.shown(part.name),
        verdicts,
      );
      return { at: left.indexOf(label), of: left.length, label };
    }
  }
  return own !== undefined && own.count > 1
    ? { at: own.index, of: own.count, label: own.label }
    : undefined;
}

/** A square button for an icon: 44 px on a phone, for a finger. */
export const ICON =
  "grid size-8 shrink-0 place-items-center rounded-dt-control text-dt-muted hover:bg-dt-raised hover:text-dt-text disabled:opacity-40 max-sm:size-11";

/** Goes to the step before or after, settled too, as h and l do. */
export function StepArrow({ by }: { readonly by: -1 | 1 }) {
  const { actor } = useTools();
  const { journey, at } = useStep();
  const last = Math.max((journey?.steps.length ?? 0) - 1, 0);
  const to = Math.min(Math.max(at + by, 0), last);
  const Icon = by < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={by < 0 ? "Step before" : "Step after"}
      disabled={to === at}
      className={ICON}
      onClick={() => actor.send({ type: "go", by })}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

/** Settles the step: it is right as it shows, with the variant the page shows; the walk then
 * goes on to the next open step. Pressed on a settled step, which a press opens again. Its
 * width stays the same for both words, so nothing beside it moves. */
export function SettleButton({ compact = false }: { readonly compact?: boolean }) {
  const { perform } = useTools();
  const { step } = useStep();
  const settled = useSession(
    (s) => step !== undefined && s.context.feedback[step.id]?.settled === true,
  );
  return (
    <button
      type="button"
      aria-pressed={settled}
      aria-label={settled ? "Settled" : "Settle"}
      title={settled ? "Open the step again" : undefined}
      onClick={() => perform({ kind: "event", event: { type: "settle" } })}
      className={cx(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-dt-control px-2.5 text-[12px] font-medium max-sm:h-11 max-sm:px-4 max-sm:text-[15px]",
        compact && "max-sm:w-11 max-sm:justify-center max-sm:px-0",
        settled
          ? "bg-dt-good/20 text-dt-good hover:bg-dt-good/30"
          : "bg-dt-accent text-white hover:bg-dt-accent/85",
      )}
    >
      <Check className="size-3.5 shrink-0 max-sm:size-4" aria-hidden />
      <span className={cx("grid text-left", compact && "max-sm:hidden")} aria-hidden>
        <span className={cx("col-start-1 row-start-1", settled && "invisible")}>Settle</span>
        <span className={cx("col-start-1 row-start-1", !settled && "invisible")}>Settled</span>
      </span>
    </button>
  );
}

/** Which variant the page shows, of how many, with the previous and the next beside it, as
 * j and k and a swipe on the part go. */
export function VariantSwitch({
  place,
}: {
  readonly place: { readonly at: number; readonly of: number; readonly label: string };
}) {
  const { perform } = useTools();
  const arrow =
    "grid size-6 shrink-0 place-items-center rounded-dt-control text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:size-11";
  return (
    <span
      role="group"
      aria-label="Variant"
      className="flex min-w-0 items-center gap-0.5 text-[12px] text-dt-muted max-sm:text-[14px]"
    >
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => perform({ kind: "variant", by: -1 })}
        className={arrow}
      >
        <ChevronLeft className="size-3.5 max-sm:size-4" aria-hidden />
      </button>
      <span className="min-w-0 truncate rounded-dt-mark bg-dt-raised px-1.5 py-px font-medium text-dt-text">
        {place.label}
      </span>
      <span className="shrink-0 px-1 whitespace-nowrap tabular-nums">
        {place.at + 1} of {place.of}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => perform({ kind: "variant", by: 1 })}
        className={arrow}
      >
        <ChevronRight className="size-3.5 max-sm:size-4" aria-hidden />
      </button>
    </span>
  );
}

/** Lifts the step's part, as v does: its variants in a row and its states in a column. */
export function LiftButton({
  variety,
  className,
}: {
  readonly variety: { readonly count: number; readonly kind: "variants" | "states" };
  readonly className?: string;
}) {
  const { perform } = useTools();
  const words = `${String(variety.count)} ${variety.kind}`;
  return (
    <button
      type="button"
      aria-label={`Lift the part: ${words}`}
      className={cx(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-dt-control px-2 text-[12px] whitespace-nowrap text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:px-2.5 max-sm:text-[14px]",
        className,
      )}
      onClick={() => perform({ kind: "lift" })}
    >
      <Layers className="size-4 shrink-0" aria-hidden />
      {words}
    </button>
  );
}
