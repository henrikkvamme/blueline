import { Schema } from "effect";
import type { Line } from "./lines.ts";

/*
 * Who took which line of the feedback file: the plain part, without files or a lock, so a
 * test can run it (bin/wire.ts holds the lock and the files). Each reader, as a listener, an
 * agent's hook or a wake, has a cursor: the ID of the last line it went past. A line one
 * reader claimed is no other reader's, so a pull and a wake never both deliver it.
 */

export const ClaimsSchema = Schema.Struct({
  /** By reader: the ID of the last line it went past. */
  cursors: Schema.Record(Schema.String, Schema.String),
  /** By line ID: the reader that took it, and when, in ms. */
  claimed: Schema.Record(Schema.String, Schema.Struct({ by: Schema.String, at: Schema.Finite })),
});
export type Claims = typeof ClaimsSchema.Type;

export const NO_CLAIMS: Claims = { cursors: {}, claimed: {} };

/**
 * The lines after the reader's cursor that no other reader claimed. A cursor whose line the
 * file no longer has means the file was started again, so every line is new.
 */
export function freshFor(lines: readonly Line[], claims: Claims, reader: string): Line[] {
  const cursor = claims.cursors[reader];
  const at = cursor === undefined ? -1 : lines.findIndex((l) => l.id === cursor);
  return lines.slice(at + 1).filter((l) => (claims.claimed[l.id]?.by ?? reader) === reader);
}

/** The claims after the reader took `taken` and went past the line `through`; with no
 * `through`, its cursor stays. */
export const claimedBy = (
  claims: Claims,
  reader: string,
  taken: readonly Line[],
  through: string | undefined,
  now: number,
): Claims => ({
  cursors: through === undefined ? claims.cursors : { ...claims.cursors, [reader]: through },
  claimed: {
    ...claims.claimed,
    ...Object.fromEntries(taken.map((l) => [l.id, { by: reader, at: now }])),
  },
});

/** The cursor that a read mark in bytes, from before the claims, stands for: the last line
 * that starts before it. */
export const cursorAtByte = (lines: readonly Line[], mark: number): string | undefined =>
  lines.filter((l) => l.start < mark).at(-1)?.id;
