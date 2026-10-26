import { useState } from "react";
import { REQUESTS, STATUSES, type Status } from "./data";
import { RequestRows } from "./request-rows";

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
      <RequestRows rows={rows} />
    </main>
  );
}
