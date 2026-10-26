import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "../../ui/cx";
import { dropped, parts, type Verdicts } from "../../part/store";
import { variants } from "../../part/variants";
import {
  Chip,
  FormSection,
  Page,
  PART,
  PARTS,
  partOf,
  SubmitButton,
  SuggestionCard,
  type Part,
  type PartId,
  type Shown,
} from "./parts";

/*
 * The lift workshop: a made-up matter page whose parts each have variants and states. Each
 * part is made with variants() (part/variants.tsx), as an app makes its parts. One part is
 * the reviewed one, as a step's part is in a review; v lifts it.
 */

interface Props {
  readonly state: number;
}

/** Each state of a workshop part as a patch: the state's number. */
const statesOf = (part: Part) =>
  Object.fromEntries(part.states.map((name, i) => [name, { state: i }]));

/** Each variant of a workshop part, drawn by its number. */
const looksOf = <P extends Props>(part: Part, draw: (shown: Shown, props: P) => ReactNode) =>
  Object.fromEntries(
    part.variants.map((v, i) => [
      v.label,
      (props: P) => draw({ variant: i, state: props.state }, props),
    ]),
  );

const ChipPart = variants(
  PART.chip.title,
  looksOf(PART.chip, (s) => <Chip shown={s} />),
  statesOf(PART.chip),
);
const ButtonPart = variants(
  PART.button.title,
  looksOf(PART.button, (s) => <SubmitButton shown={s} />),
  statesOf(PART.button),
);
const CardPart = variants(
  PART.card.title,
  looksOf(PART.card, (s) => <SuggestionCard shown={s} />),
  statesOf(PART.card),
);
const SectionPart = variants(
  PART.section.title,
  looksOf(PART.section, (s) => <FormSection shown={s} />),
  statesOf(PART.section),
);
const PagePart = variants(
  PART.page.title,
  looksOf<Props & { readonly part: (id: Exclude<PartId, "page">) => ReactNode }>(
    PART.page,
    (s, p) => <Page shown={s} part={p.part} />,
  ),
  statesOf(PART.page),
);

/** The state each part has on the page. */
const START: Record<PartId, number> = { chip: 0, button: 0, card: 0, section: 1, page: 0 };

/** The parts that take their content's size; the others fill their column. */
const HUG: ReadonlySet<PartId> = new Set(["chip", "button"]);

export function LiftWorkshop() {
  const [reviewed, setReviewed] = useState<PartId>("card");
  // The verdicts, with each one before them, so u takes the last one back.
  const [history, setHistory] = useState<readonly Readonly<Record<string, Verdicts>>[]>([{}]);
  const verdicts = history.at(-1) ?? {};
  const main = useRef<HTMLElement>(null);
  const now = useSyncExternalStore(parts.subscribe, parts.current);
  useEffect(() => parts.judge(verdicts), [verdicts]);

  const draw = (id: Exclude<PartId, "page">) =>
    id === "chip" ? (
      <ChipPart state={START.chip} />
    ) : id === "button" ? (
      <ButtonPart state={START.button} />
    ) : id === "card" ? (
      <CardPart state={START.card} />
    ) : (
      <SectionPart state={START.section} />
    );

  const target = (id: PartId, children: ReactNode): ReactNode => (
    <div
      onClick={(e) => {
        e.stopPropagation();
        setReviewed(id);
      }}
      className={cx(
        "relative w-fit max-w-full cursor-pointer rounded-[10px] transition-shadow",
        HUG.has(id) ? "" : "w-full",
        reviewed === id
          ? "shadow-[0_0_0_2px_#4a6cf7]"
          : "hover:shadow-[0_0_0_1px_rgb(74_108_247/0.35)]",
      )}
    >
      {children}
    </div>
  );

  const part = partOf(reviewed);
  const shown = now.shown[part.title];

  useEffect(() => {
    const drop = (variant: string) =>
      setHistory((h) => {
        const was = h.at(-1) ?? {};
        const name = partOf(reviewed).title;
        const next = dropped(was[name] ?? { kept: [], dropped: [] }, variant);
        return [...h, { ...was, [name]: next }];
      });
    const onKey = (e: KeyboardEvent) => {
      if (parts.current().lifting !== undefined || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "v" && main.current !== null) {
        const found = parts.under([main.current], partOf(reviewed).title);
        if (found === undefined) return;
        e.preventDefault();
        parts.lift(found.id, {
          drop,
          undo: () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)),
        });
      } else if (e.key === "Tab") {
        e.preventDefault();
        const i = PARTS.findIndex((p) => p.id === reviewed);
        const next = PARTS[(i + (e.shiftKey ? PARTS.length - 1 : 1)) % PARTS.length];
        if (next !== undefined) setReviewed(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewed]);

  return (
    <div className="flex min-h-screen gap-8 bg-[#f1f1f4] p-8 text-[#16161a]">
      <aside className="blueline sticky top-8 flex h-fit w-[300px] shrink-0 flex-col gap-5 rounded-dt-panel bg-dt-panel p-4 text-dt-text shadow-dt-float">
        <div className="flex flex-col gap-1.5">
          <span className="text-[15px] font-semibold">Lift</span>
          <p className="text-[13px] leading-[1.45] text-dt-muted">
            <Key>v</Key> lifts the reviewed part. <Key>h</Key> <Key>l</Key> move through its
            variants, in a row, and <Key>j</Key> <Key>k</Key> through its states, in a column.{" "}
            <Key>z</Key> zooms in, <Key>d</Key> deletes a variant and <Key>u</Key> brings it back.{" "}
            <Key>Enter</Key> uses what is shown, <Key>Esc</Key> closes the lift.
          </p>
        </div>
        <Group title="The reviewed part" hint="Tab, or a click on the page">
          {PARTS.map((p) => (
            <Choice key={p.id} on={reviewed === p.id} onClick={() => setReviewed(p.id)}>
              <span className="flex-1 first-letter:uppercase">{p.title}</span>
              <span className="text-[11px] text-dt-faint">{p.size}</span>
            </Choice>
          ))}
        </Group>
        <div className="flex flex-col gap-1 border-t border-dt-line pt-3 text-[12px] text-dt-muted">
          <span>
            Variant:{" "}
            <span className="text-dt-text">{shown?.variant ?? part.variants[0]?.label}</span>
          </span>
          <span>
            State: <span className="text-dt-text">{shown?.state ?? "As it is"}</span>
          </span>
          <span>
            Deleted:{" "}
            <span className="text-dt-text">
              {verdicts[part.title]?.dropped.join(", ") || "none"}
            </span>
          </span>
        </div>
      </aside>
      <main ref={main} className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1100px] overflow-hidden rounded-xl border border-[#e4e4e9] bg-white shadow-sm">
          {target("page", <PagePart state={START.page} part={(id) => target(id, draw(id))} />)}
        </div>
      </main>
    </div>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between text-[11px] font-medium text-dt-faint">
        {title}
        <span>{hint}</span>
      </span>
      {children}
    </div>
  );
}

function Choice({
  on,
  onClick,
  children,
}: {
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex flex-1 items-center gap-2 rounded-dt-control px-2.5 py-1.5 text-left text-[13px]",
        on ? "bg-dt-raised text-dt-text" : "text-dt-muted hover:bg-dt-raised/60",
      )}
    >
      {children}
    </button>
  );
}

function Key({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="rounded-dt-mark bg-dt-raised px-1 py-px font-sans text-[11px] text-dt-text">
      {children}
    </kbd>
  );
}
