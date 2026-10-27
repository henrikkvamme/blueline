import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Layers,
  TriangleAlert,
} from "lucide-react";
import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { NO_VERDICTS, partOn, parts, variantOf, variantRows, varietyOf } from "../part/store";
import { keepsAnother } from "../session/state";
import { cx } from "./cx";
import { settleWords } from "./settle";
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
 * the step's own; none with fewer than two. `kept` is the one listed that the step's settle
 * kept, while the step is settled. */
export function useVariantPlace():
  | {
      readonly at: number;
      readonly of: number;
      readonly label: string;
      readonly labels: readonly string[];
      readonly kept: string | undefined;
    }
  | undefined {
  const { journey, step } = useStep();
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  const own = useVariant(step);
  const feedback = useSession((s) =>
    step === undefined ? undefined : s.context.feedback[step.id],
  );
  if (step === undefined) return undefined;
  const part = partOn(step, journey);
  const rows = variantRows(
    part,
    part === undefined ? NOTHING : (now.shown[part.name] ?? parts.shown(part.name)),
    part === undefined ? NO_VERDICTS : (now.verdicts[part.name] ?? NO_VERDICTS),
    { labels: step.variants?.map((v) => v.label) ?? [], at: own?.index ?? 0 },
  );
  if (rows === undefined) return undefined;
  const kept =
    feedback?.settled !== true
      ? undefined
      : rows.from === "part"
        ? feedback.parts?.[part?.name ?? ""]?.kept.at(-1)
        : feedback.variant;
  return {
    labels: rows.labels,
    at: rows.at,
    of: rows.labels.length,
    label: rows.labels[rows.at] ?? "",
    kept: kept !== undefined && rows.labels.includes(kept) ? kept : undefined,
  };
}

/**
 * Whether the page shows another variant than the one the step's settle kept, so a settle
 * keeps the one shown: of the step's part, as the dev tools' settle reads it, and of the
 * step's own. False on a step that is open.
 */
function useKeepsAnother(): boolean {
  const { journey, step } = useStep();
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  const own = useVariant(step);
  const feedback = useSession((s) =>
    step === undefined ? undefined : s.context.feedback[step.id],
  );
  if (step === undefined || feedback?.settled !== true) return false;
  const part = partOn(step, journey);
  const keep =
    part === undefined || part.labels.length <= 1
      ? undefined
      : {
          part: part.name,
          variant: variantOf(
            part.labels,
            now.shown[part.name] ?? parts.shown(part.name),
            now.verdicts[part.name] ?? NO_VERDICTS,
          ),
        };
  const ownLabel = (step.variants?.length ?? 0) > 1 ? own?.label : undefined;
  return keepsAnother(feedback, keep, ownLabel);
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

/** On a settled step's button, what hides and what shows under the pointer or the focus. */
const AWAY = "group-hover:invisible group-focus-visible:invisible";
const AGAIN = "group-hover:visible group-focus-visible:visible";

/** Settles the step: it is right as it shows, with the variant the page shows; the walk then
 * goes on to the next open step. On a step that lists variants it names the one it keeps,
 * "Keep Cards", and once settled the one it kept, "Kept Cards", in green. Under the pointer or
 * the focus a settled step's button says "Open again", and a press opens the step again and
 * stays on it, as y does. On a settled step that shows another variant it turns blue
 * again, "Keep Table": a
 * press keeps that one in place of the old (settle.ts). Its width stays the same whatever it
 * says, so nothing beside it moves: a long name ends in an ellipsis. In the panel's foot it is
 * the one primary action, as wide as the room between the step arrows; in the bar, `wide`
 * gives it a fixed room for a name. */
export function SettleButton({
  compact = false,
  foot = false,
  wide = false,
}: {
  readonly compact?: boolean;
  readonly foot?: boolean;
  readonly wide?: boolean;
}) {
  const { perform } = useTools();
  const { step } = useStep();
  const place = useVariantPlace();
  const feedback = useSession((s) =>
    step === undefined ? undefined : s.context.feedback[step.id],
  );
  const settled = feedback?.settled === true;
  const kept =
    place?.kept ??
    Object.values(feedback?.parts ?? {})
      .flatMap((v) => v.kept)
      .at(-1) ??
    feedback?.variant;
  const another = useKeepsAnother();
  const words = settleWords({ settled, shown: place?.label, kept, another });
  // Settle and Settled share one room, so a step with no variants keeps its width too.
  const plain = !wide && !foot;
  return (
    <button
      type="button"
      {...KEEP_FOCUS}
      data-dt-settle=""
      aria-pressed={words.kept}
      aria-label={words.label}
      title={words.label}
      onClick={() => perform({ kind: "event", event: { type: "settle" } })}
      className={cx(
        "group flex shrink-0 items-center justify-center gap-1.5 rounded-dt-control font-medium transition-colors duration-150 motion-reduce:transition-none",
        foot
          ? "h-10 min-w-0 flex-1 px-3 text-[14px] max-sm:h-11 max-sm:text-[15px]"
          : "h-8 px-2.5 text-[12px] max-sm:h-11 max-sm:px-4 max-sm:text-[15px]",
        wide && "w-40",
        compact && "max-sm:w-11 max-sm:justify-center max-sm:px-0",
        words.kept
          ? "bg-dt-good/15 text-dt-good hover:bg-dt-good/25"
          : "bg-dt-accent text-white hover:bg-dt-accent/85",
      )}
    >
      <span className="grid shrink-0" aria-hidden>
        <Check className={cx("col-start-1 row-start-1 size-4", words.kept && AWAY)} />
        <CircleDashed
          className={cx("col-start-1 row-start-1 size-4 invisible", words.kept && AGAIN)}
        />
      </span>
      {plain && place === undefined && kept === undefined ? (
        <span className={cx("grid text-left", compact && "max-sm:hidden")} aria-hidden>
          <span className={cx("col-start-1 row-start-1", words.kept && "invisible")}>Settle</span>
          <span className={cx("col-start-1 row-start-1", words.kept ? AWAY : "invisible")}>
            Settled
          </span>
          <span className={cx("col-start-1 row-start-1 invisible", words.kept && AGAIN)}>
            Open again
          </span>
        </span>
      ) : (
        <span className={cx("grid min-w-0", compact && "max-sm:hidden")} aria-hidden>
          <span className={cx("col-start-1 row-start-1 truncate", words.kept && AWAY)}>
            {words.text}
          </span>
          <span className={cx("col-start-1 row-start-1 invisible truncate", words.kept && AGAIN)}>
            Open again
          </span>
        </span>
      )}
    </button>
  );
}

/**
 * The step's variants, under its words: a quiet Lift at the right, and a row for each variant
 * that is left, as radios. The row of the variant shown is raised. A click shows that variant
 * on the page, as j and k, or its number, do. On a settled step, a small green check at the
 * row's right marks the variant its settle kept, apart from the radio of the one shown, so
 * shown and kept never look the same. A part with one variant and some states has no rows:
 * its states show in the lift only.
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
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {label === place.kept && (
                  <Check className="size-3.5 shrink-0 text-dt-good" aria-label="Kept" />
                )}
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

/** Why the step's code failed or was late: the panel's step has the words in full. */
export function StepTrouble({ reason }: { readonly reason: string | undefined }) {
  if (reason === undefined) return null;
  return (
    <TriangleAlert
      role="img"
      aria-label={reason}
      className="size-3.5 shrink-0 self-center text-dt-bad"
    >
      <title>{reason}</title>
    </TriangleAlert>
  );
}
