import { ChevronsLeftRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "../cx";
import { boxOf, type Box } from "../geometry";
import { useImageUrl } from "../images";
import { useSession, useTools } from "../session";
import { label, type Of, type Props } from "./shared";

/*
 * The blocks about the page: the variants the agent made, the changes on the page, and a
 * before and after.
 */

/** The variants the agent made, side by side: a click shows one on the page. */
export function Variants({ block, note }: Props<"variants">) {
  const { actor } = useTools();
  const url = useImageUrl();
  const showing = useSession((s) => {
    const shape = s.context.journeys
      .find((j) => j.id === s.context.journey)
      ?.steps.find((st) => st.id === note.step);
    return shape?.variants[s.context.variants[note.step] ?? 0];
  });
  const show = (label: string) => actor.send({ type: "showVariant", step: note.step, label });
  return (
    <div className="flex flex-col gap-1.5">
      {block.text !== undefined && <span className={label}>{block.text}</span>}
      <ul
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${String(Math.min(block.items.length, 3))}, 1fr)` }}
      >
        {block.items.map((item) => {
          const shown = showing === item.label;
          return (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => show(item.label)}
                className={cx(
                  "flex h-full w-full flex-col gap-1 rounded-dt-control bg-dt-raised p-1.5 text-left hover:bg-dt-line",
                  shown && "ring-1 ring-dt-accent ring-inset",
                )}
              >
                {item.image !== undefined && (
                  <img
                    src={url({ name: item.image, file: "" })}
                    alt=""
                    className="aspect-[8/5] w-full rounded-dt-mark object-cover object-top"
                  />
                )}
                <span className="flex items-center gap-1 text-[12px] font-medium">
                  {item.label}
                  {shown && <span className="text-[10px] font-normal text-dt-accent">Showing</span>}
                </span>
                {item.detail !== undefined && (
                  <span className="text-[11px] leading-[1.35] text-dt-muted">{item.detail}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Where a change is: an outline on the page while the pointer is on the change. */
function useLight(target: string | undefined) {
  const [box, setBox] = useState<Box | undefined>(undefined);
  useEffect(() => {
    if (target === undefined) return setBox(undefined);
    const update = () => setBox(boxOf([target]));
    update();
    window.addEventListener("scroll", update, true);
    return () => window.removeEventListener("scroll", update, true);
  }, [target]);
  return box;
}

/** The changes the agent made, numbered: the pointer on one lights its element on the page,
 * and a click scrolls to it. */
export function Changes({ block }: Of<"changes">) {
  const [over, setOver] = useState<string | undefined>(undefined);
  const box = useLight(over);
  return (
    <div className="flex flex-col gap-1">
      <span className={label}>
        {block.items.length === 1 ? "1 change" : `${String(block.items.length)} changes`}
      </span>
      <ol className="flex flex-col">
        {block.items.map((item, i) => (
          <li key={String(i)}>
            <button
              type="button"
              disabled={item.target === undefined}
              onPointerEnter={() => setOver(item.target)}
              onPointerLeave={() => setOver(undefined)}
              onFocus={() => setOver(item.target)}
              onBlur={() => setOver(undefined)}
              onClick={() =>
                item.target !== undefined &&
                document
                  .querySelector(item.target)
                  ?.scrollIntoView({ block: "center", behavior: "smooth" })
              }
              className="flex w-full items-start gap-2 rounded-dt-control px-1.5 py-1 text-left text-[13px] leading-5 enabled:hover:bg-dt-raised"
            >
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-dt-accent text-[9px] font-semibold text-white tabular-nums">
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{item.text}</span>
                {(item.before !== undefined || item.after !== undefined) && (
                  <span className="flex flex-wrap items-baseline gap-1 text-[12px] leading-4">
                    {item.before !== undefined && (
                      <span className="rounded-dt-mark bg-dt-bad/15 px-1 text-dt-muted line-through decoration-dt-bad/60">
                        {item.before}
                      </span>
                    )}
                    <span className="text-dt-faint" aria-hidden>
                      →
                    </span>
                    {item.after !== undefined && (
                      <span className="rounded-dt-mark bg-dt-good/15 px-1 text-dt-text">
                        {item.after}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {box !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none fixed z-[2147483001] rounded-dt-control ring-2 ring-dt-accent ring-offset-2 ring-offset-transparent transition-all duration-150"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      )}
    </div>
  );
}

/** Before and after, one over the other: the handle or the arrow keys move the line. */
export function Compare({ block }: Of<"compare">) {
  const url = useImageUrl();
  const [at, setAt] = useState(50);
  return (
    <div className="flex flex-col gap-1">
      {block.text !== undefined && <span className={label}>{block.text}</span>}
      <div className="relative overflow-hidden rounded-dt-control border border-dt-line select-none">
        <img src={url({ name: block.before, file: "" })} alt="Before" className="block w-full" />
        <img
          src={url({ name: block.after, file: "" })}
          alt="After"
          className="absolute inset-0 block size-full object-cover object-left-top"
          style={{ clipPath: `inset(0 0 0 ${String(at)}%)` }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-dt-accent"
          style={{ left: `${String(at)}%` }}
        >
          <span className="absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-dt-accent text-white shadow-dt-float">
            <ChevronsLeftRight className="size-3.5" aria-hidden />
          </span>
        </span>
        <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-dt-mark bg-black/65 px-1 text-[10px] text-white">
          Before
        </span>
        <span className="pointer-events-none absolute top-1.5 right-1.5 rounded-dt-mark bg-black/65 px-1 text-[10px] text-white">
          After
        </span>
        <input
          name="blueline-before-after"
          type="range"
          min={0}
          max={100}
          value={at}
          aria-label="Before and after"
          onChange={(e) => setAt(Number(e.currentTarget.value))}
          className="absolute inset-0 size-full cursor-ew-resize opacity-0"
        />
      </div>
    </div>
  );
}
