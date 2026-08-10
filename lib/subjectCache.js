import { readJsonCache, writeJsonCache } from "./cacheStore.js";

const CACHE_FILE = "subjects.json";

// Subjects (radicals/kanji/vocabulary content) rarely change — WaniKani's own
// docs recommend caching them "as aggressively as possible" — so entries have
// no TTL. They aren't frozen, though: WaniKani adds accepted meanings and
// fixes readings, and a stale copy silently grades those answers wrong. Once a
// day, ask what changed and patch what we hold.
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * On-disk shape is `{ subjects: {id: subject}, refreshedAt }`. Older versions
 * stored a bare `{id: subject}` map — read those transparently rather than
 * throwing away a warm cache on upgrade.
 */
function parseCache(raw) {
  if (!raw || typeof raw !== "object") return { subjects: new Map(), refreshedAt: null };
  if (raw.subjects) {
    return { subjects: new Map(Object.entries(raw.subjects)), refreshedAt: raw.refreshedAt ?? null };
  }
  return { subjects: new Map(Object.entries(raw)), refreshedAt: null };
}

export async function loadSubjectCache() {
  return parseCache(await readJsonCache(CACHE_FILE));
}

export async function saveSubjectCache({ subjects, refreshedAt }) {
  await writeJsonCache(CACHE_FILE, { subjects: Object.fromEntries(subjects), refreshedAt });
}

/**
 * Pulls anything updated since the last check into the cached copies we
 * already hold. Best-effort: a failure here must not take down a review
 * session, and leaving `refreshedAt` alone means it simply retries later.
 * Returns whether the cache changed.
 */
async function refreshStaleSubjects(client, cache) {
  if (cache.subjects.size === 0 || !cache.refreshedAt) return false;
  if (Date.now() - new Date(cache.refreshedAt).getTime() < REFRESH_INTERVAL_MS) return false;

  try {
    const updated = await client.getSubjectsUpdatedAfter(cache.refreshedAt);
    for (const subject of updated) {
      // Only patch subjects already cached — `updated_after` returns the whole
      // catalogue's changes, and there's no reason to hoard the rest.
      if (cache.subjects.has(String(subject.id))) cache.subjects.set(String(subject.id), subject);
    }
    cache.refreshedAt = new Date().toISOString();
    return true;
  } catch {
    return false;
  }
}

/** Like client.getSubjectsByIds, but reads/writes a local on-disk cache first. */
export async function getSubjectsCached(client, ids) {
  const cache = await loadSubjectCache();
  let dirty = await refreshStaleSubjects(client, cache);

  const missingIds = ids.filter((id) => !cache.subjects.has(String(id)));
  if (missingIds.length > 0) {
    const fetched = await client.getSubjectsByIds(missingIds);
    for (const [id, subject] of fetched) cache.subjects.set(String(id), subject);
    cache.refreshedAt ??= new Date().toISOString();
    dirty = true;
  }

  if (dirty) await saveSubjectCache(cache);

  const result = new Map();
  for (const id of ids) {
    const subject = cache.subjects.get(String(id));
    if (subject) result.set(id, subject);
  }
  return result;
}
