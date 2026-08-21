import { readJsonCache, writeJsonCache } from "./cacheStore.js";

const CRITICAL_FILE = "critical.json";

/**
 * The line WaniKani's own critical-items page draws: anything answered
 * correctly less than 75% of the time is in critical condition. It's the
 * site's number rather than one of ours on purpose — the point of this list
 * is that it's the same list, so "22 items" here and "22 items in critical
 * condition" there agree.
 */
export const CRITICAL_THRESHOLD = 75;

/**
 * The items in critical condition, worst first.
 *
 * WaniKani keeps a running correct/incorrect tally for every item you've ever
 * been quizzed on and will hand back the ones under a threshold directly, so
 * this is a filter and a sort rather than a calculation. `hidden` items are
 * left out because they're subjects WaniKani has retired from the curriculum:
 * they can't come up in a review again and there is nothing to be done about
 * their percentage.
 *
 * Burned items stay in. An item you burned but still get wrong three times in
 * four is exactly what this list is for, and it's the one place it can be
 * seen — nothing schedules it any more.
 */
export async function fetchCritical(client, { under = CRITICAL_THRESHOLD } = {}) {
  const stats = await client.getReviewStatistics({
    percentages_less_than: under,
    hidden: false,
  });

  return stats
    .map((stat) => ({
      subjectId: stat.data.subject_id,
      subjectType: stat.data.subject_type,
      percentageCorrect: stat.data.percentage_correct,
    }))
    // Worst first, the way the website orders them. Ties break on id so two
    // runs of the same list come back in the same order.
    .sort((a, b) => a.percentageCorrect - b.percentageCorrect || a.subjectId - b.subjectId);
}

/**
 * Files the list that was just fetched, so `grade` can tell a critical-item
 * drill from an answer that belongs nowhere.
 *
 * Without this, grading one of these prints `NOT RECORDED — subject 440 isn't
 * in the current batch`, which is true and reads like a fault. Nothing here is
 * meant to be recorded; the whole list is a drill.
 */
export async function saveCritical(items) {
  await writeJsonCache(CRITICAL_FILE, {
    fetchedAt: new Date().toISOString(),
    items: items.map((item) => ({ subjectId: item.subjectId })),
  });
}

/** The subject ids of the last critical list fetched. */
export async function loadCritical() {
  const raw = await readJsonCache(CRITICAL_FILE);
  return Array.isArray(raw?.items) ? raw.items : [];
}

/** Whether this subject was on that list — what makes a `grade` call a drill. */
export async function isCriticalItem(subjectId) {
  return (await loadCritical()).some((item) => item.subjectId === subjectId);
}
