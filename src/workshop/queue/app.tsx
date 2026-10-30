import type { ReactNode } from "react";
import { PAGES, changeOf, type Path } from "./script";

/*
 * The made-up app that the queue workshop reviews: a bonus request on three pages. An element
 * that the agent changed shows its new words.
 */

export function AppNav({ path }: { readonly path: Path }) {
  return (
    <nav className="flex gap-1 text-[13px]">
      {PAGES.map((p) => (
        <span
          key={p.path}
          className={
            p.path === path
              ? "rounded-md bg-[#e8edff] px-3 py-1.5 font-medium text-[#3550c8]"
              : "rounded-md px-3 py-1.5 text-[#5b5b66]"
          }
        >
          {p.title}
        </span>
      ))}
    </nav>
  );
}

const card =
  "flex flex-col gap-6 rounded-xl border border-[#e4e4e9] bg-white p-8 [&_h1]:text-[24px] [&_h1]:font-semibold";

/** The made-up app. An element that the agent changed shows its new words. */
export function AppPage({
  path,
  changed,
  status,
}: {
  readonly path: Path;
  readonly changed: ReadonlySet<string>;
  readonly status: string;
}) {
  const words = (target: string) => {
    const change = changeOf(target);
    return changed.has(target) ? change.after : change.before;
  };
  if (path === "/approvers")
    return (
      <section className={card}>
        <h1>Approvers</h1>
        <div data-q="approver-list" className="flex flex-col gap-2">
          {APPROVERS.map((a, i) => (
            <div
              key={a.name}
              className="flex items-center justify-between rounded-md bg-[#f1f1f4] px-3 py-2 text-[14px]"
            >
              <span className="flex items-center gap-2">
                <span className="text-[#8a8a94]">⠿</span>
                <span className="text-[12px] text-[#8a8a94] tabular-nums">{i + 1}</span>
                <span className="font-medium">{a.name}</span>
              </span>
              <span className="text-[#5b5b66]">
                {i === 0 && changed.has("approver-list") ? words("approver-list") : a.role}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          data-q="add"
          className="self-start rounded-md border border-[#dcdce3] px-3 py-1.5 text-[13px] font-medium"
        >
          {words("add")}
        </button>
      </section>
    );
  if (path === "/sent")
    return (
      <section className={card}>
        <h1>Sent for approval</h1>
        <p data-q="sent" className="text-[14px] text-[#5b5b66]">
          {words("sent")} Ingrid Berg gets it once Ola Hansen approves.
        </p>
      </section>
    );
  return (
    <section className={card}>
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium tracking-wide text-[#8a8a94] uppercase">
          A made-up page
        </span>
        <div data-q="title" className="flex flex-col gap-1">
          <h1>{words("title")}</h1>
          <span className="text-[13px] text-[#5b5b66]">Asked by Ola Hansen · 2 days ago</span>
        </div>
        <span data-q="status" className="w-fit">
          <Status look={status} text={changed.has("status") ? words("status") : "In review"} />
        </span>
      </div>
      <label data-q="amount" className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium">Amount</span>
        <input
          name="amount"
          value={words("amount")}
          readOnly
          className="rounded-md border border-[#dcdce3] px-3 py-2 text-[14px] tabular-nums"
        />
      </label>
      <div data-q="approvers" className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Approvers</span>
        {APPROVERS.map((a) => (
          <div
            key={a.name}
            className="flex justify-between rounded-md bg-[#f1f1f4] px-3 py-2 text-[14px]"
          >
            <span className="font-medium">{a.name}</span>
            <span className="text-[#5b5b66]">{a.role}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        data-q="submit"
        className="self-end rounded-md bg-[#4a6cf7] px-4 py-2 text-[14px] font-medium text-white"
      >
        {words("submit")}
      </button>
    </section>
  );
}

const APPROVERS = [
  { name: "Ola Hansen", role: "Director" },
  { name: "Ingrid Berg", role: "Finance" },
] as const;

export function Status({
  look,
  text,
}: {
  readonly look: string;
  readonly text: string;
}): ReactNode {
  if (look === "Pill")
    return (
      <span className="rounded-full bg-[#e8edff] px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap text-[#3550c8]">
        {text}
      </span>
    );
  if (look === "Steps")
    return (
      <span className="flex items-center gap-1 text-[12px] whitespace-nowrap text-[#5b5b66]">
        <span className="h-1 w-6 rounded-full bg-[#4a6cf7]" />
        <span className="h-1 w-6 rounded-full bg-[#4a6cf7]" />
        <span className="h-1 w-6 rounded-full bg-[#dcdce3]" />
        <span className="ml-1">{text}</span>
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-[13px] whitespace-nowrap text-[#5b5b66]">
      <span className="size-2 rounded-full bg-[#4a6cf7]" />
      {text}
    </span>
  );
}
