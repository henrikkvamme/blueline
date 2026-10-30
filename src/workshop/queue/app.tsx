import { useState, type ReactNode } from "react";
import { cx } from "../../ui/cx";
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
  statusText,
}: {
  readonly path: Path;
  readonly changed: ReadonlySet<string>;
  /** The status's look, and the state that it shows, when not its own. */
  readonly status: string;
  readonly statusText?: string | undefined;
}) {
  // The reviewer's own click adds an approver; the guide's cursor never clicks.
  const [added, setAdded] = useState(false);
  const words = (target: string) => {
    const change = changeOf(target);
    return changed.has(target) ? change.after : change.before;
  };
  if (path === "/approvers")
    return (
      <section className={card}>
        <h1>Approvers</h1>
        <div data-q="approver-list" className="flex flex-col gap-2">
          {(added ? [...APPROVERS, ADDED] : APPROVERS).map((a, i) => (
            <div
              key={a.name}
              className={cx(
                "flex items-center justify-between rounded-md bg-[#f1f1f4] px-3 py-2 text-[14px]",
                a === ADDED && "animate-dt-arrive bg-[#e8edff]",
              )}
            >
              <span className="flex items-center gap-2">
                <span data-q={i === 0 ? "grip" : undefined} className="text-[#8a8a94]">
                  ⠿
                </span>
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
          onClick={() => setAdded(true)}
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
          <span data-q="asker" className="w-fit text-[13px] text-[#5b5b66]">
            Asked by Ola Hansen · 2 days ago
          </span>
        </div>
        <span data-q="status" className="w-fit">
          <Status
            look={status}
            text={statusText ?? (changed.has("status") ? words("status") : "In review")}
          />
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

const ADDED = { name: "Kari Nordmann", role: "HR" };

const APPROVERS: readonly { readonly name: string; readonly role: string }[] = [
  { name: "Ola Hansen", role: "Director" },
  { name: "Ingrid Berg", role: "Finance" },
];

/** The colours of a status: blue while it moves, green when approved, red when sent back. */
const TONES: Readonly<
  Record<string, { readonly mark: string; readonly tint: string; readonly ink: string }>
> = {
  Approved: { mark: "#2f9e6a", tint: "#e3f5ec", ink: "#1f7a50" },
  "Sent back": { mark: "#d6455d", tint: "#fbe7ea", ink: "#a8304a" },
};
const MOVING = { mark: "#4a6cf7", tint: "#e8edff", ink: "#3550c8" };

/** How far each status has come, of three steps. */
const DONE: Readonly<Record<string, number>> = { Approved: 3, "Sent back": 1 };

export function Status({
  look,
  text,
}: {
  readonly look: string;
  readonly text: string;
}): ReactNode {
  const tone = TONES[text] ?? MOVING;
  if (look === "Pill")
    return (
      <span
        className="rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap"
        style={{ background: tone.tint, color: tone.ink }}
      >
        {text}
      </span>
    );
  if (look === "Steps") {
    const done = DONE[text] ?? 2;
    return (
      <span className="flex items-center gap-1 text-[12px] whitespace-nowrap text-[#5b5b66]">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className="h-1 w-6 rounded-full"
            style={{ background: n <= done ? tone.mark : "#dcdce3" }}
          />
        ))}
        <span className="ml-1">{text}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[13px] whitespace-nowrap text-[#5b5b66]">
      <span className="size-2 rounded-full" style={{ background: tone.mark }} />
      {text}
    </span>
  );
}
