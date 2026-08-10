import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs `fn` with WANIKANI_CACHE_DIR pointed at a throwaway directory, so tests
 * never read or clobber the real cache in the user's home directory.
 */
export async function withTempCacheDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "wanikani-cache-test-"));
  const previous = process.env.WANIKANI_CACHE_DIR;
  process.env.WANIKANI_CACHE_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.WANIKANI_CACHE_DIR;
    else process.env.WANIKANI_CACHE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

export async function captureStdout(fn) {
  const original = console.log;
  let output = "";
  console.log = (msg) => {
    output += `${msg}\n`;
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return output;
}
