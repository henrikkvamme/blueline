import { Check, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { NO_VERDICTS, partOn, parts, variantRows, varietyOf } from "../part/store";
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

const NOTHING = { variant: undefined, state: undefined };

/** The variants the step lists, and the one it shows: its part's variants not deleted, else
 * the step's own; none with fewer than two. */
export function useVariantPlace():
  | {
      readonly at: number;
      readonly of: number;
      readonly label: string;
      readonly labels: readonly string[];
    }
  | undefined {
  const { journey, step } = useStep();
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  const own = useVariant(step);
  if (step === undefined) return undefined;
  const part = partOn(step, journey);
  const rows = variantRows(
    part,
    part === undefined ? NOTHING : (now.shown[part.name] ?? parts.shown(part.name)),
    part === undefined ? NO_VERDICTS : (now.verdicts[part.name] ?? NO_VERDICTS),
    { labels: step.variants?.map((v) => v.label) ?? [], at: own?.index ?? 0 },
  );
  if (rows === undefined) return undefined;
  return { ...rows, of: rows.labels.length, label: rows.labels[rows.at] ?? "" };
}

/** A click on a step control leaves the focus where it was, as on the page, so the walk's
 * keys go on there: Enter settles, and j and k show the variants. Tab still reaches it. */
export const KEEP_FOCUS = { onMouseDown: (e: MouseEvent) => e.preventDefault() };

/** A square button for an icon: 44 px on a phone, for a finger. */
export const ICON =
  "grid size-8 shrink-0 place-items-center rounded-dt-control text-dt-muted hover:bg-dt-raised hover:text-dt-text disabled:opacity-40 max-sm:size-11";

/** The step arrows in the panel's foot: 40 px squares on a raised tint, beside Settle. */
const FOOT_ARROW =
  "grid size-10 shrink-0 place-items-center rounded-dt-control bg-dt-raised text-dt-muted hover:bg-dt-line hover:text-dt-text disabled:opacity-40 disabled:hover:bg-dt-raised max-sm:size-11";

/** Goes to the step before or after, settled too, as h and l do: left and right of Settle,
 * across the panel's foot, while the variants go down the panel. In the panel's foot it is a
 * raised square. */
export function StepArrow({ by, foot = false }: { readonly by: -1 | 1; readonly foot?: boolean }) {
  const { actor } = useTools();
  const { journey, at } = useStep();
  const last = Math.max((journey?.steps.length ?? 0) - 1, 0);
  const to = Math.min(Math.max(at + by, 0), last);
  const Icon = by < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      {...KEEP_FOCUS}
      aria-label={by < 0 ? "Step before" : "Step after"}
      disabled={to === at}
      className={foot ? FOOT_ARROW : ICON}
      onClick={() => actor.send({ type: "go", by })}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

/** Settles the step: it is right as it shows, with the variant the page shows; the walk then
 * goes on to the next open step. Pressed on a settled step, which a press opens again. Its
 * width stays the same for both words, so nothing beside it moves. In the panel's foot it is
 * the one primary action, as wide as the room between the step arrows. */
export function SettleButton({
  compact = false,
  foot = false,
}: {
  readonly compact?: boolean;
  readonly foot?: boolean;
}) {
  const { perform } = useTools();
  const { step } = useStep();
  const settled = useSession(
    (s) => step !== undefined && s.context.feedback[step.id]?.settled === true,
  );
  return (
    <button
      type="button"
      {...KEEP_FOCUS}
      data-dt-settle=""
      aria-pressed={settled}
      aria-label={settled ? "Settled" : "Settle"}
      title={settled ? "Open the step again" : undefined}
      onClick={() => perform({ kind: "event", event: { type: "settle" } })}
      className={cx(
        "flex shrink-0 items-center justify-center gap-1.5 rounded-dt-control font-medium transition-colors duration-150 motion-reduce:transition-none",
        foot
          ? "h-10 min-w-0 flex-1 text-[14px] max-sm:h-11 max-sm:text-[15px]"
          : "h-8 px-2.5 text-[12px] max-sm:h-11 max-sm:px-4 max-sm:text-[15px]",
        compact && "max-sm:w-11 max-sm:justify-center max-sm:px-0",
        settled
          ? "bg-dt-good/15 text-dt-good hover:bg-dt-good/25"
          : "bg-dt-accent text-white hover:bg-dt-accent/85",
      )}
    >
      <Check className="size-4 shrink-0" aria-hidden />
      <span className={cx("grid text-left", compact && "max-sm:hidden")} aria-hidden>
        <span className={cx("col-start-1 row-start-1", settled && "invisible")}>Settle</span>
        <span className={cx("col-start-1 row-start-1", !settled && "invisible")}>Settled</span>
      </span>
    </button>
  );
}

/**
 * The step's variants, under its words: a quiet Lift at the right, and a row for each variant
 * that is left, as radios. The row of the variant shown is raised. A click shows that variant
 * on the page, as j and k, or its number, do. A part with one variant and some states has no
 * rows: its states show in the lift only.
 */
export function StepVariants() {
  const { perform } = useTools();
  const place = useVariantPlace();
  const variety = useVariety();
  if (place === undefined && variety === undefined) return null;
  return (
    <section
      aria-label={place === undefined ? "States" : "Variants"}
      className="flex shrink-0 flex-col gap-1.5 px-4 pt-5 max-sm:gap-0 max-sm:pt-2"
    >
      <div className="flex h-7 items-center justify-between max-sm:h-11">
        <span className="text-[12px] text-dt-faint">
          {place === undefined ? "States" : "Variants"}
        </span>
        <button
          type="button"
          {...KEEP_FOCUS}
          aria-label="Lift the part"
          title="Lift the part: its variants in a row, its states in a column"
          onClick={() => perform({ kind: "lift" })}
          className="-mr-2 flex h-7 items-center gap-1.5 rounded-dt-control px-2 text-[12px] text-dt-muted hover:bg-dt-raised hover:text-dt-text max-sm:h-11 max-sm:px-3 max-sm:text-[14px]"
        >
          <Layers className="size-3.5 shrink-0" aria-hidden />
          Lift
        </button>
      </div>
      {place !== undefined && (
        <div role="radiogroup" aria-label="Variant shown" className="flex flex-col gap-1">
          {place.labels.map((label, i) => {
            const on = i === place.at;
            return (
              <button
                key={label}
                type="button"
                {...KEEP_FOCUS}
                role="radio"
                aria-checked={on}
                onClick={() => {
                  if (!on) perform({ kind: "variant", by: i - place.at });
                }}
                className={cx(
                  "flex h-9 items-center gap-2.5 rounded-dt-control px-2.5 text-left text-[13px] transition-colors duration-150 motion-reduce:transition-none max-sm:h-11 max-sm:text-[15px]",
                  on
                    ? "bg-dt-raised text-dt-text ring-1 ring-white/7 ring-inset"
                    : "text-dt-muted hover:bg-dt-raised/60 hover:text-dt-text",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "size-3.5 shrink-0 rounded-full border-[1.5px] transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
                    on
                      ? "border-dt-accent shadow-[inset_0_0_0_2px_var(--dt-raised),inset_0_0_0_7px_var(--dt-accent)]"
                      : "border-dt-faint/70",
                  )}
                />
                <span className="min-w-0 truncate">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The foot of the panel on a step and at the finish: the one primary action between the
 * quiet ones, in one place from step to step. */
export function Foot({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-dt-line px-3 py-2.5">
      {children}
    </div>
  );
}
