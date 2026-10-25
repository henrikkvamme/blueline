import { useState } from "react";
import { money, REQUESTS, STATUSES, type Status } from "./data";
import { Link } from "./link";
import { requestPath } from "./router";
import { StatusPill } from "./status";

/** The list of requests, with a tab for each status. */
export function RequestsPage() {
  const [shown, setShown] = useState<Status | "All">("All");
  const rows = shown === "All" ? REQUESTS : REQUESTS.filter((r) => r.status === shown);
  const tabs: readonly (Status | "All")[] = ["All", ...STATUSES];
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10 max-sm:px-4">
      <h1 className="text-2xl font-semibold text-slate-900">Requests</h1>
      <nav data-review="status-tabs" aria-label="Status" className="flex gap-1">
        {tabs.map((tab) => {
          const count =
            tab === "All" ? REQUESTS.length : REQUESTS.filter((r) => r.status === tab).length;
          return (
            <button
              key={tab}
              type="button"
              aria-pressed={shown === tab}
              onClick={() => setShown(tab)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                shown === tab
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {tab}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </nav>
      <table data-review="request-table" className="w-full text-left text-sm">
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
                {r.status === "Waiting" ? (
                  `${String(r.waiting)} d`
                ) : (
                  <span className="text-slate-300">-</span>
                )}
              </td>
              <td className="py-3 text-right text-slate-900 tabular-nums">{money(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
