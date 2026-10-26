import { useState } from "react";
import { money, REQUESTS } from "./data";
import { Link } from "./link";
import { RequestHeader } from "./request-header";

/** One request: its header, its facts, its history and the decision on it. */
export function RequestPage({ id }: { readonly id: string }) {
  const request = REQUESTS.find((r) => r.id === id);
  const [reply, setReply] = useState("");
  const [decided, setDecided] = useState<string>();
  if (request === undefined)
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-10 max-sm:px-4">
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">
          Requests
        </Link>
        <p className="text-slate-700">No request is called {id}.</p>
      </main>
    );
  const facts: readonly (readonly [string, string])[] = [
    ["Asked by", request.requester],
    ["Team", request.team],
    ["Cost centre", request.costCentre],
    ["Sent", request.submitted],
  ];
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-10 max-sm:px-4">
      <Link to="/" className="self-start text-sm text-slate-500 hover:text-slate-900">
        Requests
      </Link>
      <div data-review="request-header">
        <RequestHeader request={request} />
      </div>
      <section className="grid grid-cols-[1fr_auto] gap-6 rounded-xl bg-slate-50 p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-slate-500">{term}</dt>
              <dd className="text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col items-end gap-1">
          <span className="text-sm text-slate-500">Amount</span>
          <span className="text-xl text-slate-900 tabular-nums">{money(request.amount)}</span>
        </div>
        <p className="col-span-2 text-sm text-slate-700">{request.reason}</p>
      </section>
      <section data-review="request-history" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-slate-500">History</h2>
        <ol className="flex flex-col gap-3">
          {request.history.map((e) => (
            <li key={`${e.at}-${e.what}`} className="flex gap-4 text-sm">
              <span className="w-28 shrink-0 text-slate-500 tabular-nums">{e.at}</span>
              <span className="text-slate-600">
                <span className="text-slate-900">{e.who}</span> {e.what}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section data-review="request-decision" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-slate-500">Decision</h2>
        <textarea
          name="reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder={`A reply to ${request.requester.split(" ")[0] ?? ""}`}
          className="rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-slate-400"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDecided("Approved")}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setDecided("Sent back")}
            className="rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Send back
          </button>
          {decided !== undefined && <span className="text-sm text-slate-500">{decided}</span>}
        </div>
      </section>
    </main>
  );
}
