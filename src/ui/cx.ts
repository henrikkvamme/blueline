/** Joins class names, leaving out the ones not given. */
export const cx = (...names: readonly (string | false | undefined)[]) =>
  names.filter((n) => typeof n === "string" && n !== "").join(" ");
