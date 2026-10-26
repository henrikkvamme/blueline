/*
 * The events a config's actions send to the page (config/actions.ts). They run the app's own
 * handlers only: Blueline's keys pass them by, so `{ press: "Escape" }` does not leave the step.
 */

const sent = new WeakSet<Event>();

/** Marks an event that an action sends. */
export function markSent<E extends Event>(event: E): E {
  sent.add(event);
  return event;
}

/** Whether an action sent the event. */
export const isSent = (event: Event): boolean => sent.has(event);
