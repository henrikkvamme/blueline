import { variants } from "@henrikkvamme/blueline/variants";
import { money, type Request } from "./data";
import { StatusPill } from "./status";

/*
 * The request page's header, in three variants for the review. The first is the one a build
 * ships. Its states show the same request once approved and once sent back.
 */

interface Props {
  readonly request: Request;
}

const waited = (r: Request) =>
  r.status === "Waiting" ? `Waits ${String(r.waiting)} ${r.waiting === 1 ? "day" : "days"}` : "";

function TitleFirst({ request: r }: Props) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold text-slate-900">{r.title}</h1>
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span className="tabular-nums">{r.id}</span>
        <span>{r.requester}</span>
        <StatusPill status={r.status} />
        <span>{waited(r)}</span>
      </div>
    </header>
  );
}

function StatusFirst({ request: r }: Props) {
  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <StatusPill status={r.status} />
        <span>{waited(r)}</span>
      </div>
      <h1 className="text-2xl font-semibold text-slate-900">{r.title}</h1>
      <p className="text-sm text-slate-500">
        {r.id}, asked by {r.requester} on {r.submitted}
      </p>
    </header>
  );
}

function CompactRow({ request: r }: Props) {
  return (
    <header className="flex items-baseline gap-3">
      <span className="text-sm text-slate-400 tabular-nums">{r.id}</span>
      <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-slate-900">{r.title}</h1>
      <StatusPill status={r.status} />
      <span className="text-right text-lg text-slate-900 tabular-nums">{money(r.amount)}</span>
    </header>
  );
}

export const RequestHeader = variants<Props>(
  "Request header",
  {
    "Title first": TitleFirst,
    "Status first": StatusFirst,
    "Compact row": CompactRow,
  },
  {
    Approved: { request: { status: "Approved" } },
    "Sent back": { request: { status: "Sent back" } },
  },
);
