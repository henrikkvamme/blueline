/*
 * The keys of a ⋯ menu, as plain data, so a host that takes the keys itself, as the lift,
 * lets the open menu's keys through to it.
 */

/** Where a key moves the focus in the menu's items: down, up, or not at all. */
export function menuMove(key: string): 1 | -1 | 0 {
  if (key === "ArrowDown" || key === "j") return 1;
  if (key === "ArrowUp" || key === "k") return -1;
  return 0;
}

/** The item after a move, round from the last to the first and back; the first item from
 * none. */
export function menuNext(at: number, by: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (at < 0) return by > 0 ? 0 : count - 1;
  return (((at + by) % count) + count) % count;
}

/** Whether an open menu takes the key: its moves, Escape, Tab, and Enter and Space, which
 * press the focused item. */
export function menuTakes(key: string): boolean {
  return menuMove(key) !== 0 || key === "Escape" || key === "Tab" || key === "Enter" || key === " ";
}
