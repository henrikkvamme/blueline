/*
 * The review's log: one JSON line per thing that happens to a reviewer's line, in the order
 * it happens, beside the feedback file. The server writes what the reviewer sent and what the
 * page showed (server/channel.ts), the agent's side writes each claim, lapse, give-back and
 * reply (bin/wire.ts, bin/reply.ts). Each writer only appends, and nothing reads it but
 * `blueline log`, so a write that fails loses one entry and stops nothing. Node loads this
 * file from the plugin's source, so it imports nothing.
 */

/** Where the log of the review whose lines are in `feedback` is. */
export const logPath = (feedback: string) => `${feedback}.log.jsonl`;

/** What the page tells the log, besides the reviewer's lines. */
export type PageEntry =
  /** The panel showed a note in a new state: "Sent", "The agent is on it", the reply. */
  | {
      readonly event: "shown";
      readonly note: string;
      readonly step: string;
      readonly state: string;
    }
  /** A step opened: when it was asked for, the time of each phase of its code, and the
   * whole time to ready, in ms. `trouble` when it failed. */
  | {
      readonly event: "step";
      readonly journey: string;
      readonly step: string;
      readonly variant?: string | undefined;
      readonly asked: number;
      readonly phases: readonly { readonly name: string; readonly ms: number }[];
      readonly total: number;
      readonly trouble?: string | undefined;
    };
