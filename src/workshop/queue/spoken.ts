import { setup, transition, types } from "xstate";

/*
 * A message that the reviewer spoke to the workshop's agent, from his words to its reply.
 * Nothing he says is lost on the way: it stays in the workshop's outbox, kept in storage, until
 * the agent replied to it or he gave it up.
 *
 * - The page sends it, and sends it again with a growing wait until the server takes it. The
 *   server takes a message once by its ID, so a second send does no harm.
 * - The server says when the agent read it, what the agent does, and its reply. The server's
 *   boot ID comes with each event: a server that started again lost what it held, so each
 *   message it had taken goes back to be sent.
 * - A reload keeps each message where it was, and the page reads the server's events again
 *   from where it stopped.
 *
 * The lifecycle is a state machine, used through its pure transition, as a note's is: a
 * message stays plain data.
 */

export const SPOKEN_STATES = ["queued", "sending", "taken", "read", "replied", "failed"] as const;
export type SpokenState = (typeof SPOKEN_STATES)[number];

export interface Spoken {
  /** A UUID: the server takes a message once by it, and the agent's session knows it by it. */
  readonly id: string;
  /** What the agent heard him say. */
  readonly said: string;
  /** What he pointed at and saw, and the screenshots, as the agent gets them. */
  readonly context: unknown;
  /** When he said it, in ms. */
  readonly at: number;
  readonly state: SpokenState;
  /** How many times the page sent it. */
  readonly tries: number;
  /** When to send it next, in ms, while it is queued. */
  readonly sendAt: number;
  /** The server that took it, by its boot ID. */
  readonly boot?: string | undefined;
  /** What the agent does about it now, in a few words. */
  readonly status?: string | undefined;
  /** The agent's last words on it, or why it failed. */
  readonly reply?: string | undefined;
}

export type SpokenEvent =
  /** The page sends it now. */
  | { readonly type: "send" }
  /** The server took it. */
  | { readonly type: "taken"; readonly boot: string }
  /** The server did not answer, or said no: send it again after a wait. */
  | { readonly type: "refused"; readonly at: number }
  /** The agent read it. */
  | { readonly type: "read" }
  /** What the agent does about it. */
  | { readonly type: "doing"; readonly status: string }
  | { readonly type: "replied"; readonly text: string }
  | { readonly type: "failed"; readonly why: string }
  /** The server that took it started again, and lost it: send it again now. */
  | { readonly type: "lost"; readonly at: number }
  /** He asks for it again, after it failed. */
  | { readonly type: "retry"; readonly at: number };

/** The wait before the next send: 1 s, doubling to at most 15 s. */
export const backoff = (tries: number) => Math.min(15_000, 1000 * 2 ** Math.max(0, tries - 1));

type Context = Omit<Spoken, "state">;

const event = <T extends SpokenEvent["type"]>() =>
  types<Omit<Extract<SpokenEvent, { readonly type: T }>, "type">>();

const doing = ({ event }: { event: { status: string } }) => ({
  target: "read" as const,
  context: { status: event.status },
});
const replied = ({ event }: { event: { text: string } }) => ({
  target: "replied" as const,
  context: { reply: event.text, status: undefined },
});
const failed = ({ event }: { event: { why: string } }) => ({
  target: "failed" as const,
  context: { reply: event.why, status: undefined },
});
/** Back to be sent, at once: what the server held, it lost. */
const lost = ({ event }: { event: { at: number } }) => ({
  target: "queued" as const,
  context: { sendAt: event.at, boot: undefined, status: undefined },
});

const lifecycle = setup({
  schemas: {
    context: types<Context>(),
    input: types<Context>(),
    events: {
      send: event<"send">(),
      taken: event<"taken">(),
      refused: event<"refused">(),
      read: event<"read">(),
      doing: event<"doing">(),
      replied: event<"replied">(),
      failed: event<"failed">(),
      lost: event<"lost">(),
      retry: event<"retry">(),
    },
  },
}).createMachine({
  id: "spoken",
  context: ({ input }) => input,
  initial: "queued",
  states: {
    queued: {
      on: {
        send: ({ context }) => ({ target: "sending", context: { tries: context.tries + 1 } }),
      },
    },
    sending: {
      on: {
        taken: ({ event }) => ({ target: "taken", context: { boot: event.boot } }),
        refused: ({ context, event }) => ({
          target: "queued",
          context: { sendAt: event.at + backoff(context.tries) },
        }),
        // The server's events can come before its answer to the send.
        read: { target: "read" },
        doing,
        replied,
        failed,
      },
    },
    taken: {
      on: { read: { target: "read" }, doing, replied, failed, lost },
    },
    read: {
      on: { doing: ({ event }) => ({ context: { status: event.status } }), replied, failed, lost },
    },
    replied: {},
    failed: {
      on: {
        retry: ({ event }) => ({
          target: "queued",
          context: { sendAt: event.at, reply: undefined },
        }),
      },
    },
  },
});

const isState = (value: unknown): value is SpokenState =>
  typeof value === "string" && SPOKEN_STATES.some((s) => s === value);

/** The message after `event`. An event that its state does not take leaves it as it was. */
export function spokenAfter(message: Spoken, event: SpokenEvent): Spoken {
  const { state, ...context } = message;
  const snapshot = lifecycle.resolveState({ value: state, context });
  const [next] = transition(lifecycle, snapshot, event);
  return { ...next.context, state: isState(next.value) ? next.value : state };
}

/** A message he just spoke, to be sent at once. */
export const spoken = (id: string, said: string, context: unknown, at: number): Spoken => ({
  id,
  said,
  context,
  at,
  state: "queued",
  tries: 0,
  sendAt: at,
});

/** Whether the agent is done with it: it replied, or it failed and waits for him. */
export const isOver = (m: Spoken) => m.state === "replied" || m.state === "failed";

/** The messages that are due to be sent now. */
export const due = (outbox: readonly Spoken[], now: number) =>
  outbox.filter((m) => m.state === "queued" && m.sendAt <= now);

/**
 * The outbox after the server's boot ID: a server that is not the one that took a message lost
 * it, so the message goes back to be sent. A reload may also leave one sending: it goes back.
 */
export const afterBoot = (outbox: readonly Spoken[], boot: string, now: number) =>
  outbox.map((m) =>
    m.state === "sending"
      ? { ...m, state: "queued" as const, sendAt: now }
      : (m.state === "taken" || m.state === "read") && m.boot !== boot
        ? spokenAfter(m, { type: "lost", at: now })
        : m,
  );

/** The outbox with one message changed, by its ID. */
export const withEvent = (outbox: readonly Spoken[], id: string, event: SpokenEvent) =>
  outbox.map((m) => (m.id === id ? spokenAfter(m, event) : m));

/** What the outbox keeps: each message not over, and the last ones that are. */
export const kept = (outbox: readonly Spoken[], over = 5) => {
  const done = outbox.filter(isOver).slice(-over);
  return outbox.filter((m) => !isOver(m) || done.includes(m));
};
