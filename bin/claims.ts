import { Schema } from "effect";
import type { Line } from "./lines.ts";

/*
 * Who took which line of the feedback file: the plain part, without files or a lock, so a
 * test can run it (bin/wire.ts holds the lock and the files). Each reader, as a listener, an
 * agent's hook or a wake, has a cursor: the ID of the last line it went past. A line one
 * reader claimed is no other reader's, so a pull and a wake never both deliver it. A reader
 * that could not deliver a line gives it back (`givenBack`): it is then fresh for every
 * reader, also behind its cursor, until one claims it.
 */

export const ClaimsSchema = Schema.Struct({
  /** By reader: the ID of the last line it went past. */
  cursors: Schema.Record(Schema.String, Schema.String),
  /** By line ID: the reader that took it, and when, in ms. */
  claimed: Schema.Record(Schema.String, Schema.Struct({ by: Schema.String, at: Schema.Finite })),
  /** By line ID: when a reader gave it back, in ms. A file from before has none. */
  returned: Schema.optional(Schema.Record(Schema.String, Schema.Finite)),
});
export type Claims = typeof ClaimsSchema.Type;

export const NO_CLAIMS: Claims = { cursors: {}, claimed: {} };

/** Where the line is in the file: -1 for none, or for a line the file no longer has. */
const placeOf = (lines: readonly Line[], id: string | undefined) =>
  id === undefined ? -1 : lines.findIndex((l) => l.id === id);

/**
 * The lines after the reader's cursor that no other reader claimed, and the lines given back.
 * A cursor whose line the file no longer has means the file was started again, so every line
 * is new.
 */
export function freshFor(lines: readonly Line[], claims: Claims, reader: string): Line[] {
  const at = placeOf(lines, claims.cursors[reader]);
  return lines.filter(
    (l, i) =>
      (i > at || claims.returned?.[l.id] !== undefined) &&
      (claims.claimed[l.id]?.by ?? reader) === reader,
  );
}

/** The cursor after a reader went past `through`: a line given back is behind the cursor,
 * and the cursor never moves back to it. */
export function laterOf(
  lines: readonly Line[],
  cursor: string | undefined,
  through: string | undefined,
): string | undefined {
  if (through === undefined) return cursor;
  return placeOf(lines, through) > placeOf(lines, cursor) ? through : cursor;
}

/** The claims after the reader took `taken` and went past the line `through`; with no
 * `through`, its cursor stays. */
export function claimedBy(
  claims: Claims,
  reader: string,
  taken: readonly Line[],
  through: string | undefined,
  now: number,
): Claims {
  const returned = Object.entries(claims.returned ?? {}).filter(
    ([id]) => !taken.some((l) => l.id === id),
  );
  return {
    cursors: through === undefined ? claims.cursors : { ...claims.cursors, [reader]: through },
    claimed: {
      ...claims.claimed,
      ...Object.fromEntries(taken.map((l) => [l.id, { by: reader, at: now }])),
    },
    // A file with none returned stays as W0 wrote it.
    ...(returned.length === 0 ? {} : { returned: Object.fromEntries(returned) }),
  };
}

/** The claims after the reader gave back the lines `ids` that it still holds; the same
 * claims when it holds none of them. No cursor moves. */
export function givenBack(
  claims: Claims,
  reader: string,
  ids: readonly string[],
  now: number,
): Claims {
  const held = ids.filter((id) => claims.claimed[id]?.by === reader);
  if (held.length === 0) return claims;
  return {
    ...claims,
    claimed: Object.fromEntries(
      Object.entries(claims.claimed).filter(([id]) => !held.includes(id)),
    ),
    returned: { ...claims.returned, ...Object.fromEntries(held.map((id) => [id, now])) },
  };
}

/** The cursor that a read mark in bytes, from before the claims, stands for: the last line
 * that starts before it. */
export const cursorAtByte = (lines: readonly Line[], mark: number): string | undefined =>
  lines.filter((l) => l.start < mark).at(-1)?.id;
