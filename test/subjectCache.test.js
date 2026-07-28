import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSubjectsCached } from "../lib/subjectCache.js";

async function withTempCacheDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "wanikani-cache-test-"));
  const previous = process.env.WANIKANI_CACHE_DIR;
  process.env.WANIKANI_CACHE_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.WANIKANI_CACHE_DIR;
    else process.env.WANIKANI_CACHE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

function fakeSubject(id) {
  return { id, object: "kanji", data: { characters: `subj-${id}` } };
}

test("getSubjectsCached fetches from the client on a cold cache", async () => {
  await withTempCacheDir(async () => {
    let calls = 0;
    const client = {
      async getSubjectsByIds(ids) {
        calls += 1;
        return new Map(ids.map((id) => [id, fakeSubject(id)]));
      },
    };

    const result = await getSubjectsCached(client, [1, 2]);
    assert.equal(calls, 1);
    assert.equal(result.get(1).data.characters, "subj-1");
    assert.equal(result.get(2).data.characters, "subj-2");
  });
});

test("getSubjectsCached serves from disk on a warm cache without calling the client again", async () => {
  await withTempCacheDir(async () => {
    let calls = 0;
    const client = {
      async getSubjectsByIds(ids) {
        calls += 1;
        return new Map(ids.map((id) => [id, fakeSubject(id)]));
      },
    };

    await getSubjectsCached(client, [1, 2]);
    const result = await getSubjectsCached(client, [1, 2]);

    assert.equal(calls, 1); // second call should be a cache hit, not a second fetch
    assert.equal(result.get(1).data.characters, "subj-1");
  });
});

test("getSubjectsCached only fetches the ids missing from the cache", async () => {
  await withTempCacheDir(async () => {
    const requestedBatches = [];
    const client = {
      async getSubjectsByIds(ids) {
        requestedBatches.push([...ids]);
        return new Map(ids.map((id) => [id, fakeSubject(id)]));
      },
    };

    await getSubjectsCached(client, [1, 2]);
    const result = await getSubjectsCached(client, [2, 3]);

    assert.deepEqual(requestedBatches, [[1, 2], [3]]);
    assert.equal(result.size, 2);
    assert.equal(result.get(2).data.characters, "subj-2");
    assert.equal(result.get(3).data.characters, "subj-3");
  });
});
