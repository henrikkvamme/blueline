import { variants } from "@henrikkvamme/blueline/variants";
import type { JSX } from "react";
import { money, type Request } from "./data";
import { Link } from "./link";
import { requestPath } from "./router";
import { StatusPill } from "./status";

/*
 * The list page's requests, in three variants for the review. The first is the one a build
 * ships. Its state shows the list with no request in the chosen tab.
 */

interface Props {
  readonly rows: readonly Request[];
}

const waited = (r: Request) => (r.status === "Waiting" ? `${String(r.waiting)} d` : undefined);

function Empty() {
  return <p className="py-10 text-center text-sm text-slate-500">No requests here.</p>;
}

function Table({ rows }: Props) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-500">
        <tr className="border-b border-slate-200">
          <th className="py-2 pr-4 font-normal">Request</th>
          <th className="py-2 pr-4 font-normal max-sm:hidden">Asked by</th>
          <th className="py-2 pr-4 font-normal">Status</th>
          <th className="py-2 pr-4 text-right font-normal">Waiting</th>
          <th className="py-2 text-right font-normal">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} data-review={`request-${r.id}`} className="border-b border-slate-100">
            <td className="py-3 pr-4">
              <Link to={requestPath(r.id)} className="flex flex-col hover:underline">
                <span className="font-medium text-slate-900">{r.title}</span>
                <span className="text-slate-500 tabular-nums">{r.id}</span>
              </Link>
            </td>
            <td className="py-3 pr-4 text-slate-700 max-sm:hidden">
              {r.requester}
              <span className="block text-slate-500">{r.team}</span>
            </td>
            <td className="py-3 pr-4">
              <StatusPill status={r.status} />
            </td>
            <td className="py-3 pr-4 text-right text-slate-700 tabular-nums">
              {waited(r) ?? <span className="text-slate-300">-</span>}
            </td>
            <td className="py-3 text-right text-slate-900 tabular-nums">{money(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cards({ rows }: Props) {
  return (
    <ul className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      {rows.map((r) => (
        <li key={r.id} data-review={`request-${r.id}`}>
          <Link
            to={requestPath(r.id)}
            className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-medium text-slate-900">{r.title}</span>
              <StatusPill status={r.status} />
            </div>
            <div className="mt-auto flex items-end justify-between gap-3 text-sm">
              <span className="text-slate-500">
                {r.requester}, {r.team}
                {waited(r) === undefined ? null : (
                  <span className="block tabular-nums">Waits {waited(r)}</span>
                )}
              </span>
              <span className="text-base text-slate-900 tabular-nums">{money(r.amount)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const DOTS: Readonly<Record<Request["status"], string>> = {
  Waiting: "bg-amber-400",
  Approved: "bg-emerald-500",
  "Sent back": "bg-rose-500",
};

function DenseList({ rows }: Props) {
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {rows.map((r) => (
        <li key={r.id} data-review={`request-${r.id}`}>
          <Link
            to={requestPath(r.id)}
            className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-slate-50"
          >
            <span
              role="img"
              aria-label={r.status}
              title={r.status}
              className={`size-2 shrink-0 rounded-full ${DOTS[r.status]}`}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{r.title}</span>
            <span className="w-32 truncate text-slate-500 max-sm:hidden">{r.requester}</span>
            <span className="w-10 text-right text-slate-500 tabular-nums">
              {waited(r) ?? <span className="text-slate-300">-</span>}
            </span>
            <span className="w-24 text-right text-slate-900 tabular-nums">{money(r.amount)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const shell =
  (View: (props: Props) => JSX.Element) =>
  ({ rows }: Props) => (
    <div data-review="request-table">{rows.length === 0 ? <Empty /> : <View rows={rows} />}</div>
  );

export const RequestRows = variants<Props>(
  "Request rows",
  {
    Table: shell(Table),
    Cards: shell(Cards),
    "Dense list": shell(DenseList),
  },
  {
    Empty: { rows: [] },
  },
);
