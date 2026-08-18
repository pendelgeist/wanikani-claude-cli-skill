import { readJsonCache, writeJsonCache } from "./cacheStore.js";

const MISSES_FILE = "misses.json";

// Enough to drill from for days, few enough that the file stays a list rather
// than a history. What falls off the end is what you got wrong longest ago,
// which WaniKani is already scheduling for you.
const MAX_MISSES = 100;

/**
 * The items answered wrong recently, newest first.
 *
 * It exists because "let's re-review my recent mistakes" is a thing people ask
 * for, and the session that was asked had nowhere to get the list: it
 * reconstructed nineteen items from the chat log and quizzed them from memory,
 * romaji corrections and all. The record knows exactly which items were missed
 * — it just wasn't keeping them once they were submitted.
 *
 * Kept in its own file rather than in the sitting, because a mistake outlives
 * the sitting it was made in.
 */
export async function loadMisses({ limit } = {}) {
  const raw = await readJsonCache(MISSES_FILE);
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return limit ? items.slice(0, limit) : items;
}

/**
 * Files what a batch got wrong. One entry per subject: missing the same item
 * twice moves it to the front rather than listing it twice, since the drill
 * asks about items and not about occasions.
 */
export async function recordMisses(entries) {
  const fresh = entries.filter((entry) => entry.subjectId != null && (entry.wrongMeaning || entry.wrongReading));
  if (fresh.length === 0) return;

  const at = new Date().toISOString();
  const seen = new Set(fresh.map((entry) => entry.subjectId));
  const items = [
    ...fresh.map((entry) => ({
      subjectId: entry.subjectId,
      missedMeaning: (entry.wrongMeaning ?? 0) > 0,
      missedReading: (entry.wrongReading ?? 0) > 0,
      at,
    })),
    ...(await loadMisses()).filter((item) => !seen.has(item.subjectId)),
  ];
  await writeJsonCache(MISSES_FILE, { items: items.slice(0, MAX_MISSES) });
}

/** Whether this subject is one of the recent misses — what makes a `grade` call a drill. */
export async function isRecentMiss(subjectId) {
  return (await loadMisses()).some((item) => item.subjectId === subjectId);
}
