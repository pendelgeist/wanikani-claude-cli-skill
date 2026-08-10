import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function cacheDir() {
  return process.env.WANIKANI_CACHE_DIR || join(homedir(), ".cache", "wanikani-cli");
}

/** Reads a JSON cache file. Returns null when it's missing, unreadable, or corrupt. */
export async function readJsonCache(name) {
  try {
    return JSON.parse(await readFile(join(cacheDir(), name), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Writes a JSON cache file atomically. Writing straight onto the target means
 * a Ctrl-C partway through (easy to hit — these writes happen mid-session)
 * leaves truncated JSON behind, which reads back as a total cache miss. Write
 * a temp file alongside it and rename, which is atomic on the same filesystem.
 */
export async function writeJsonCache(name, value) {
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, target);
}
