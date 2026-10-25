import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  Copy,
  FileCode,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { metricTrend, type TONES } from "../../notes/blocks";
import { cx } from "../cx";
import { useImageUrl } from "../images";
import { label, type Of } from "./shared";

/*
 * The blocks that show what the agent found or did: words to read, nothing to answer.
 */

/** What the agent does, step by step, and where it is. */
export function Plan({ block }: Of<"plan">) {
  return (
    <div className="rounded-dt-control border border-dt-line p-2">
      <ol className="flex flex-col gap-0.5">
        {block.items.map((item, i) => (
          <li
            key={String(i)}
            className={cx(
              "flex items-start gap-2 text-[12.5px] leading-5",
              item.state === "done" && "text-dt-muted",
              item.state === "todo" && "text-dt-faint",
            )}
          >
            {item.state === "done" ? (
              <Check className="mt-[3px] size-3.5 shrink-0 text-dt-good" aria-label="Done" />
            ) : item.state === "doing" ? (
              <LoaderCircle
                className="mt-[3px] size-3.5 shrink-0 animate-spin text-dt-accent"
                aria-label="Doing"
              />
            ) : (
              <Circle className="mt-[3px] size-3.5 shrink-0" aria-label="To do" />
            )}
            {item.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

const TONE: Record<
  (typeof TONES)[number],
  { readonly box: string; readonly icon: string; readonly Icon: typeof Info }
> = {
  info: { box: "bg-dt-accent/10", icon: "text-dt-accent", Icon: Info },
  good: { box: "bg-dt-good/10", icon: "text-dt-good", Icon: CircleCheck },
  warn: { box: "bg-dt-warn/10", icon: "text-dt-warn", Icon: TriangleAlert },
  bad: { box: "bg-dt-bad/10", icon: "text-dt-bad", Icon: CircleAlert },
};

/** A short message that stands out, in the colour of its tone. */
export function Callout({ block }: Of<"callout">) {
  const tone = TONE[block.tone];
  return (
    <div className={cx("flex gap-2 rounded-dt-control px-2.5 py-2 text-[13px]", tone.box)}>
      <tone.Icon className={cx("mt-0.5 size-3.5 shrink-0", tone.icon)} aria-hidden />
      <span className="flex min-w-0 flex-col gap-0.5 leading-5">
        {block.title !== undefined && <span className="font-medium">{block.title}</span>}
        <span className={cx(block.title !== undefined && "text-dt-muted")}>{block.text}</span>
      </span>
    </div>
  );
}

export function Table({ block }: Of<"table">) {
  return (
    <div className="flex flex-col gap-1">
      {block.text !== undefined && <span className={label}>{block.text}</span>}
      <div className="overflow-x-auto rounded-dt-control border border-dt-line">
        <table className="w-full text-left text-[12px] leading-4">
          <thead className="bg-dt-raised text-dt-muted">
            <tr>
              {block.columns.map((c) => (
                <th key={c} className="px-2 py-1.5 font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={String(i)} className="border-t border-dt-line">
                {row.map((cell, j) => (
                  <td key={String(j)} className="px-2 py-1.5 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Code with its file, or a diff with added and removed lines in colour; it copies. */
export function Code({ block }: Of<"code">) {
  const [copied, setCopied] = useState(false);
  const lines = block.text.split("\n");
  return (
    <div className="overflow-hidden rounded-dt-control border border-dt-line bg-dt-ground">
      <div className="flex items-center gap-1.5 border-b border-dt-line px-2 py-1 text-[11px] text-dt-muted">
        <FileCode className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono">{block.file ?? "Code"}</span>
        <button
          type="button"
          aria-label="Copy the code"
          onClick={() => {
            void navigator.clipboard.writeText(block.text).then(() => setCopied(true));
          }}
          className="grid size-5 place-items-center rounded-dt-mark hover:bg-dt-raised hover:text-dt-text"
        >
          {copied ? (
            <Check className="size-3 text-dt-good" aria-hidden />
          ) : (
            <Copy className="size-3" aria-hidden />
          )}
        </button>
      </div>
      <pre className="max-h-60 overflow-auto py-1.5 font-mono text-[11.5px] leading-[1.55]">
        {lines.map((line, i) => (
          <div
            key={String(i)}
            className={cx(
              "px-2 whitespace-pre",
              block.diff === true && line.startsWith("+") && "bg-dt-good/12 text-dt-good",
              block.diff === true && line.startsWith("-") && "bg-dt-bad/12 text-dt-bad",
            )}
          >
            {line === "" ? " " : line}
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Numbers the work changed, as tiles: the value, what it was, and whether that is better. */
export function Metrics({ block }: Of<"metrics">) {
  return (
    <ul className="grid grid-cols-3 gap-1.5">
      {block.items.map((item) => {
        const trend = metricTrend(item);
        const up = Number.parseFloat(item.value) > Number.parseFloat(item.before ?? "");
        const Arrow = up ? ArrowUp : ArrowDown;
        return (
          <li
            key={item.label}
            className="flex flex-col gap-0.5 rounded-dt-control bg-dt-raised px-2 py-1.5"
          >
            <span className="truncate text-[11px] text-dt-muted">{item.label}</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[17px] leading-6 font-semibold tabular-nums">{item.value}</span>
              {trend !== undefined && (
                <Arrow
                  className={cx(
                    "size-3 self-center",
                    trend === "good" ? "text-dt-good" : "text-dt-bad",
                  )}
                  aria-label={trend === "good" ? "Better" : "Worse"}
                />
              )}
            </span>
            {item.before !== undefined && (
              <span className="text-[11px] text-dt-faint tabular-nums">
                was <span className="line-through">{item.before}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Long words kept closed, such as a log. */
export function Details({ block }: Of<"details">) {
  return (
    <details className="group/details rounded-dt-control border border-dt-line">
      <summary className="flex cursor-default list-none items-center gap-1.5 px-2 py-1.5 text-[12px] text-dt-muted hover:text-dt-text [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3 shrink-0 transition-transform group-open/details:rotate-90"
          aria-hidden
        />
        {block.summary}
      </summary>
      <pre className="max-h-60 overflow-auto border-t border-dt-line px-2 py-1.5 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap text-dt-muted">
        {block.text}
      </pre>
    </details>
  );
}

/** Screenshots the agent took, two to a row; each opens full size. */
export function Gallery({ block }: Of<"images">) {
  const url = useImageUrl();
  return (
    <ul className="grid grid-cols-2 gap-1.5">
      {block.items.map((item, i) => {
        const href = url({ name: item.image, file: "" });
        return (
          <li key={String(i)}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="group/shot flex flex-col gap-1"
            >
              <img
                src={href}
                alt={item.caption ?? `Screenshot ${String(i + 1)}`}
                className="aspect-[8/5] w-full rounded-dt-control border border-dt-line object-cover object-top group-hover/shot:border-dt-faint"
              />
              {item.caption !== undefined && (
                <span className="text-[11px] leading-[1.35] text-dt-muted">{item.caption}</span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
