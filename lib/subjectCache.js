import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Subjects (radicals/kanji/vocabulary content) rarely change — WaniKani's own
// docs recommend caching them "as aggressively as possible" — so this cache
// has no TTL. Delete the file (or set WANIKANI_CACHE_DIR elsewhere) to reset it.
function cacheFile() {
  const dir = process.env.WANIKANI_CACHE_DIR || join(homedir(), ".cache", "wanikani-cli");
  return { dir, file: join(dir, "subjects.json") };
}

export async function loadSubjectCache() {
  try {
    const raw = await readFile(cacheFile().file, "utf8");
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

export async function saveSubjectCache(cache) {
  const { dir, file } = cacheFile();
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(Object.fromEntries(cache)));
}

/** Like client.getSubjectsByIds, but reads/writes a local on-disk cache first. */
export async function getSubjectsCached(client, ids) {
  const cache = await loadSubjectCache();
  const missingIds = ids.filter((id) => !cache.has(String(id)));

  if (missingIds.length > 0) {
    const fetched = await client.getSubjectsByIds(missingIds);
    for (const [id, subject] of fetched) cache.set(String(id), subject);
    await saveSubjectCache(cache);
  }

  const result = new Map();
  for (const id of ids) {
    const subject = cache.get(String(id));
    if (subject) result.set(id, subject);
  }
  return result;
}
