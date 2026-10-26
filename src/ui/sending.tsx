import { useState } from "react";
import { SEND_MS } from "../session/machine";
import type { Pending } from "../session/state";
import { cx } from "./cx";
import { now, useSession, useTools } from "./session";

/*
 * A send that waits before the agent gets it (session/machine.ts, SEND_MS): a small ring that
 * empties as the time runs out, "Sending", and Undo, which takes it back. Undo is the newest
 * change, so `u` and Cmd+Z take it back too.
 */

/** The send that waits with this message of a chat, by the message's time; or the one that
 * sends this hand-off. */
export function usePending(
  of: { readonly chat: string; readonly at: number } | { readonly handoff: string },
): Pending | undefined {
  return useSession((s) =>
    s.context.pending.find((p) =>
      "handoff" in of ? p.handoff === of.handoff : p.chat?.id === of.chat && p.chat.at === of.at,
    ),
  );
}

/** Whether a send waits with the newest message of this chat. */
export const useWaits = (chat: string | undefined) =>
  useSession((s) => s.context.pending.some((p) => chat !== undefined && p.chat?.id === chat));

/** The ring of the time left: full when the send starts, empty when it goes. */
function Countdown({ due }: { readonly due: number }) {
  // The time it has run already, once: the ring then runs on its own, with no new render.
  const [ran] = useState(() => Math.min(SEND_MS, Math.max(0, SEND_MS - (due - now()))));
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0 -rotate-90">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        pathLength={1}
        strokeDasharray="1"
        className="motion-reduce:[animation:none]"
        style={{ animation: `dt-countdown ${String(SEND_MS)}ms linear ${String(-ran)}ms both` }}
      />
    </svg>
  );
}

/** "Sending", with the ring and Undo, under a message or a hand-off that waits. */
export function Sending({
  pending,
  className,
}: {
  readonly pending: Pending;
  readonly className?: string;
}) {
  const { actor } = useTools();
  return (
    <span
      role="status"
      className={cx("flex h-5 items-center gap-1.5 text-[12px] text-dt-muted", className)}
    >
      <Countdown due={pending.due} />
      Sending
      <button
        type="button"
        onClick={() => actor.send({ type: "unsend", id: pending.id })}
        className="rounded-dt-mark px-1 font-medium text-dt-text underline-offset-2 hover:underline max-sm:min-h-11 max-sm:px-2 max-sm:text-[14px]"
      >
        Undo
      </button>
    </span>
  );
}
