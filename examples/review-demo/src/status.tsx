import type { Status } from "./data";

/** A request's status as a pale pill, with dark text of the same hue. */
const TINTS: Readonly<Record<Status, string>> = {
  Waiting: "bg-amber-50 text-amber-800",
  Approved: "bg-emerald-50 text-emerald-800",
  "Sent back": "bg-rose-50 text-rose-800",
};

export function StatusPill({ status }: { readonly status: Status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TINTS[status]}`}>
      {status}
    </span>
  );
}
