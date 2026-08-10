/**
 * Parses a numeric CLI option. Without this, `Number()` turns a typo into NaN
 * and every downstream `if (limit)` treats that as "no limit" — so
 * `queue --limit abc` silently dumps the entire due queue instead of ten items.
 */
export function parseCount(value, { flag, min = 0 }) {
  if (value === undefined) return undefined;

  const count = Number(value);
  if (!Number.isInteger(count) || count < min) {
    throw new Error(`${flag} expects a whole number ${min > 0 ? `of ${min} or more` : "of 0 or more"}, got: ${value}`);
  }
  return count;
}
