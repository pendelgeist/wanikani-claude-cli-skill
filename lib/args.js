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

/**
 * Parses a percentage option — `--under 60`. Its own parser rather than
 * `parseCount`, because the bound that matters here is the top one: WaniKani
 * scores every item out of 100, so `--under 750` isn't a wider net, it's a
 * typo that would quietly return the whole account as "critical".
 */
export function parsePercentage(value, { flag = "--under" } = {}) {
  if (value === undefined) return undefined;

  const percentage = Number(value);
  if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
    throw new Error(`${flag} expects a whole percentage between 1 and 100, got: ${value}`);
  }
  return percentage;
}
