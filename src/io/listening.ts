import { Schema } from "effect";

/*
 * Who listens to the reviewer's notes: each agent's listener (bin/listen.ts) says it is
 * there every few seconds, by its name, with the journey it listens to. The page reads it
 * while a note waits, so a note no agent will read says so at once.
 */

export const ListeningSchema = Schema.Record(
  Schema.String,
  Schema.Struct({
    /** The journey it listens to; null for every journey. */
    journey: Schema.NullOr(Schema.String),
    /** When it last said it is there, in milliseconds. */
    at: Schema.Finite,
  }),
);
export type Listening = typeof ListeningSchema.Type;

/** How often a listener says it is there. */
export const HEARTBEAT_MS = 5_000;

/** A listener silent for longer than this has stopped, as an agent's watch ran out. */
export const SILENT_MS = 4 * HEARTBEAT_MS;

/** The journeys listened to now; null in the list means every journey. */
export const listenedJourneys = (listening: Listening, now: number): readonly (string | null)[] =>
  Object.values(listening)
    .filter((l) => now - l.at <= SILENT_MS)
    .map((l) => l.journey);

/** Whether an agent listens to the journey; undefined when the page cannot tell. */
export const isListened = (listened: readonly (string | null)[] | undefined, journey: string) =>
  listened === undefined ? undefined : listened.some((j) => j === null || j === journey);
