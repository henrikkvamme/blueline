/*
 * Where the cursor was in each dev tool field, kept in the browser's storage, so a field
 * opens where the reviewer left it, as nvim opens a file at its last place. A field names
 * itself, as `composer:<note id>`; the newest few are kept.
 */

import { STORED } from "./stored";

const KEY = `${STORED}.cursors`;
const KEEP = 100;

const read = (): Readonly<Record<string, number>> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (e): e is [string, number] => typeof e[1] === "number" && e[1] >= 0,
      ),
    );
  } catch {
    return {};
  }
};

/** Where the cursor was in this field, if it was kept. */
export const cursorOf = (field: string): number | undefined => read()[field];

/** Keeps where the cursor is in this field; the newest last, so the oldest go first. */
export function keepCursor(field: string, at: number) {
  const { [field]: _, ...rest } = read();
  const all = Object.entries({ ...rest, [field]: at }).slice(-KEEP);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    // A full or blocked storage only loses the place.
  }
}
