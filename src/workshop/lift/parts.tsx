import { ArrowRight, Check, Circle, LoaderCircle, Send, X } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../ui/cx";

/*
 * A made-up matter page for the lift workshop, in parts of every size: a status chip and a
 * button, a suggestion card, a form section, and the page around them. Each part has
 * variants, ways it could look, and states, what it shows as the matter changes.
 */

export type PartId = "chip" | "button" | "card" | "section" | "page";

export interface Shown {
  readonly variant: number;
  readonly state: number;
}

export interface Part {
  readonly id: PartId;
  readonly title: string;
  readonly size: string;
  readonly variants: readonly { readonly label: string; readonly detail: string }[];
  readonly states: readonly string[];
}

export const PART: Readonly<Record<PartId, Part>> = {
  chip: {
    id: "chip",
    title: "the status",
    size: "Small",
    variants: [
      { label: "Dot", detail: "A dot and words" },
      { label: "Pill", detail: "Words on a tint" },
      { label: "Steps", detail: "Where it is on the way" },
    ],
    states: ["In preparation", "Submitted", "Approved", "Returned"],
  },
  button: {
    id: "button",
    title: "the Submit button",
    size: "Small",
    variants: [
      { label: "Plain", detail: "The words only" },
      { label: "With icon", detail: "An arrow to say it goes" },
      { label: "With count", detail: "How many will approve" },
    ],
    states: ["Ready", "Not ready", "Sending", "Sent"],
  },
  card: {
    id: "card",
    title: "the suggestion",
    size: "Medium",
    variants: [
      { label: "Card under the field", detail: "The change in its own card" },
      { label: "Marked field", detail: "An amber ring on the field" },
      { label: "Changes in the field", detail: "Struck and added words" },
    ],
    states: ["New", "Accepted", "Rejected"],
  },
  section: {
    id: "section",
    title: "Cash flow and risks",
    size: "Large",
    variants: [
      { label: "One column", detail: "Each question under the last" },
      { label: "Two columns", detail: "Questions beside each other" },
      { label: "One at a time", detail: "A question, then the next" },
    ],
    states: ["Empty", "Filled", "With errors"],
  },
  page: {
    id: "page",
    title: "the whole page",
    size: "Page",
    variants: [
      { label: "Steps at the left", detail: "The matter's steps in a rail" },
      { label: "Steps on top", detail: "Tabs over the step" },
      { label: "One long page", detail: "All steps under each other" },
    ],
    states: ["Filled", "New", "Loading"],
  },
};

export const PARTS: readonly Part[] = Object.values(PART);

export const partOf = (id: PartId) => PART[id];

const TONES = [
  "bg-[#eef1fe] text-[#3651d6]",
  "bg-[#fff4e0] text-[#9a6400]",
  "bg-[#e6f6ee] text-[#1d7a4f]",
  "bg-[#fdecec] text-[#b2312a]",
] as const;

export function Chip({ shown }: { readonly shown: Shown }) {
  const words = partOf("chip").states[shown.state] ?? "";
  const tone = TONES[shown.state] ?? TONES[0];
  if (shown.variant === 0)
    return (
      <span className="inline-flex items-center gap-1.5 px-1 py-0.5 text-[13px] text-[#3b3b44]">
        <Circle className={cx("size-2.5 fill-current", tone.split(" ")[1])} aria-hidden />
        {words}
      </span>
    );
  if (shown.variant === 1)
    return (
      <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium", tone)}>
        {words}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-1 py-0.5 text-[12px] text-[#8a8a94]">
      {["Preparing", "Submitted", "Approved"].map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          {i > 0 && <span className="h-px w-3 bg-[#d4d4da]" />}
          <span
            className={cx(
              i < Math.min(shown.state + 1, 3) && shown.state !== 3 && "font-medium text-[#16161a]",
              shown.state === 3 && i === 0 && "font-medium text-[#b2312a]",
            )}
          >
            {shown.state === 3 && i === 0 ? "Returned" : s}
          </span>
        </span>
      ))}
    </span>
  );
}

export function SubmitButton({ shown }: { readonly shown: Shown }) {
  const state = shown.state;
  const words = ["Submit for approval", "Submit for approval", "Sending…", "Sent"][state];
  return (
    <span className="inline-flex flex-col items-end gap-1 p-1">
      <span
        className={cx(
          "inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-medium",
          state === 1 ? "bg-[#e9e9ee] text-[#9a9aa4]" : "bg-[#16161a] text-white",
          state === 3 && "bg-[#1d7a4f]",
        )}
      >
        {state === 2 && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
        {state === 3 && <Check className="size-3.5" aria-hidden />}
        {shown.variant === 1 && state < 2 && <Send className="size-3.5" aria-hidden />}
        {words}
        {shown.variant === 2 && state < 2 && (
          <span className="rounded bg-white/15 px-1.5 text-[11px] tabular-nums">4 approvers</span>
        )}
      </span>
      {state === 1 && <span className="text-[11px] text-[#8a8a94]">Answer 2 questions first</span>}
    </span>
  );
}

const BEFORE = "Northwind invoices the client monthly.";
const AFTER = "Northwind invoices the client every two weeks.";

export function SuggestionCard({ shown }: { readonly shown: Shown }) {
  const done = shown.state === 1 ? "Accepted" : shown.state === 2 ? "Rejected" : undefined;
  const field = (body: ReactNode, ring = false) => (
    <div
      className={cx(
        "rounded-md border bg-white px-3 py-2 text-[13px] leading-5",
        ring ? "border-[#e0a43b] ring-2 ring-[#e0a43b]/25" : "border-[#dcdce2]",
      )}
    >
      {body}
    </div>
  );
  const answer = shown.state === 1 ? AFTER : BEFORE;
  return (
    <div className="flex flex-col gap-2 p-4">
      <span className="flex items-center gap-2 text-[13px] font-medium">
        Cash flow
        {shown.state === 0 && shown.variant !== 0 && (
          <span className="rounded bg-[#fff4e0] px-1.5 text-[11px] text-[#9a6400]">Suggested</span>
        )}
      </span>
      {shown.variant === 2 && shown.state === 0
        ? field(
            <>
              Northwind invoices the client <s className="text-[#b2312a]">monthly.</s>{" "}
              <span className="bg-[#e6f6ee] text-[#1d7a4f]">every two weeks.</span>
            </>,
          )
        : field(answer, shown.variant === 1 && shown.state === 0)}
      {shown.state === 0 && shown.variant !== 2 && (
        <div className="flex flex-col gap-1.5 rounded-md border-l-2 border-[#e0a43b] bg-[#fffaf0] px-3 py-2">
          <span className="text-[12px] text-[#8a8a94]">Lea suggests</span>
          <span className="text-[13px]">{AFTER}</span>
          <span className="flex gap-2 pt-1">
            <span className="rounded bg-[#16161a] px-2 py-0.5 text-[12px] text-white">Accept</span>
            <span className="rounded border border-[#dcdce2] px-2 py-0.5 text-[12px]">Reject</span>
          </span>
        </div>
      )}
      {shown.state === 0 && shown.variant === 2 && (
        <span className="flex gap-2 text-[12px]">
          <span className="text-[#8a8a94]">Lea suggests this ·</span>
          <span className="font-medium">Accept</span>
          <span className="font-medium">Reject</span>
        </span>
      )}
      {done !== undefined && (
        <span className="flex items-center gap-1.5 text-[12px] text-[#8a8a94]">
          {done === "Accepted" ? (
            <Check className="size-3 text-[#1d7a4f]" aria-hidden />
          ) : (
            <X className="size-3 text-[#b2312a]" aria-hidden />
          )}
          {done} Lea's suggestion
        </span>
      )}
    </div>
  );
}

const QUESTIONS = [
  { q: "How does Northwind invoice?", a: "Every two weeks, against the schedule." },
  { q: "What are the technical risks?", a: "Dust; air monitoring runs every day." },
  { q: "Who manages changes?", a: "The project manager logs and prices each one." },
  { q: "Are there liquidated damages?", a: "Yes, $500 a day after the end date." },
] as const;

export function FormSection({ shown }: { readonly shown: Shown }) {
  const one = (i: number) => {
    const item = QUESTIONS[i];
    if (item === undefined) return null;
    const error = shown.state === 2 && i % 2 === 1;
    return (
      <label key={item.q} className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">{item.q}</span>
        <span
          className={cx(
            "min-h-9 rounded-md border bg-white px-3 py-2 text-[13px]",
            error ? "border-[#e5534b]" : "border-[#dcdce2]",
            shown.state === 0 && "text-[#b4b4bc]",
          )}
        >
          {shown.state === 0 ? "Not answered" : error ? "" : item.a}
        </span>
        {error && <span className="text-[12px] text-[#b2312a]">Answer this to submit.</span>}
      </label>
    );
  };
  return (
    <section className="flex flex-col gap-4 p-5">
      <span className="text-[15px] font-semibold">Cash flow and risks</span>
      {shown.variant === 0 && <div className="flex flex-col gap-4">{[0, 1, 2, 3].map(one)}</div>}
      {shown.variant === 1 && (
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">{[0, 1, 2, 3].map(one)}</div>
      )}
      {shown.variant === 2 && (
        <div className="flex flex-col gap-4">
          <span className="text-[12px] text-[#8a8a94]">Question 2 of 4</span>
          {one(1)}
          <span className="flex items-center gap-1 self-end text-[13px] font-medium">
            Next <ArrowRight className="size-3.5" aria-hidden />
          </span>
        </div>
      )}
    </section>
  );
}

const STEPS = ["Matter", "Triggers", "Attachments", "Cash flow and risks", "Review and submit"];

/** The page around the parts: its title, its steps and the step. */
export function Page({
  shown,
  part,
}: {
  readonly shown: Shown;
  /** Draws a part where it goes on the page. */
  readonly part: (id: Exclude<PartId, "page">) => ReactNode;
}) {
  if (shown.state === 2)
    return (
      <div className="flex flex-col gap-4 p-8">
        {[56, 30, 90, 90, 70].map((w, i) => (
          <span
            key={String(i)}
            className="h-5 animate-pulse rounded bg-[#ececf0]"
            style={{ width: `${String(w)}%` }}
          />
        ))}
      </div>
    );
  const fresh = shown.state === 1;
  const title = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[24px] leading-tight font-semibold tracking-tight">
          {fresh ? "New matter" : "Harbour Bridge Repaint"}
        </span>
        {part("chip")}
      </div>
      {part("button")}
    </div>
  );
  const body = fresh ? (
    <p className="rounded-lg border border-dashed border-[#dcdce2] p-8 text-center text-[13px] text-[#8a8a94]">
      Start with the matter's name and region.
    </p>
  ) : (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-[#e4e4e9] bg-[#fbfbfc]">{part("card")}</div>
      <div className="rounded-lg border border-[#e4e4e9]">{part("section")}</div>
    </div>
  );
  if (shown.variant === 0)
    return (
      <div className="flex">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-[#ececf0] bg-[#f6f6f8] p-3 text-[13px]">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cx(
                "rounded-md px-2.5 py-1.5",
                i === 3 && !fresh ? "bg-white font-medium shadow-sm" : "text-[#5b5b66]",
              )}
            >
              {s}
            </span>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-6 p-7">
          {title}
          {body}
        </div>
      </div>
    );
  if (shown.variant === 1)
    return (
      <div className="flex flex-col gap-6 p-7">
        {title}
        <nav className="flex gap-1 border-b border-[#ececf0] text-[13px]">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cx(
                "-mb-px border-b-2 px-2.5 py-2",
                i === 3 && !fresh
                  ? "border-[#16161a] font-medium"
                  : "border-transparent text-[#5b5b66]",
              )}
            >
              {s}
            </span>
          ))}
        </nav>
        {body}
      </div>
    );
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6 p-7">
      {title}
      {STEPS.slice(0, 3).map((s) => (
        <div
          key={s}
          className="flex items-center justify-between border-b border-[#ececf0] pb-2 text-[13px]"
        >
          <span className="font-medium">{s}</span>
          <span className="text-[#1d7a4f]">Done</span>
        </div>
      ))}
      {body}
    </div>
  );
}
