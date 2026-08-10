import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getSubjectsCached } from "../lib/subjectCache.js";
import { withTempCacheDir } from "./helpers.js";

function fakeSubject(id, characters = `subj-${id}`) {
  return { id, object: "kanji", data: { characters } };
}

function fakeClient() {
  const client = {
    batches: [],
    updatedAfterCalls: [],
    updated: [],
    async getSubjectsByIds(ids) {
      client.batches.push([...ids]);
      return new Map(ids.map((id) => [id, fakeSubject(id)]));
    },
    async getSubjectsUpdatedAfter(since) {
      client.updatedAfterCalls.push(since);
      return client.updated;
    },
  };
  return client;
}

async function writeCache(dir, contents) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "subjects.json"), JSON.stringify(contents));
}

test("getSubjectsCached fetches from the client on a cold cache", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const result = await getSubjectsCached(client, [1, 2]);

    assert.equal(client.batches.length, 1);
    assert.equal(result.get(1).data.characters, "subj-1");
    assert.equal(result.get(2).data.characters, "subj-2");
  });
});

test("getSubjectsCached serves from disk on a warm cache without calling the client again", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    await getSubjectsCached(client, [1, 2]);
    const result = await getSubjectsCached(client, [1, 2]);

    assert.equal(client.batches.length, 1); // second call should be a cache hit, not a second fetch
    assert.equal(result.get(1).data.characters, "subj-1");
  });
});

test("getSubjectsCached only fetches the ids missing from the cache", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    await getSubjectsCached(client, [1, 2]);
    const result = await getSubjectsCached(client, [2, 3]);

    assert.deepEqual(client.batches, [[1, 2], [3]]);
    assert.equal(result.size, 2);
    assert.equal(result.get(3).data.characters, "subj-3");
  });
});

test("a cache written by an older version is read instead of thrown away", async () => {
  await withTempCacheDir(async (dir) => {
    await writeCache(dir, { 1: fakeSubject(1, "legacy") });
    const client = fakeClient();

    const result = await getSubjectsCached(client, [1]);

    assert.equal(result.get(1).data.characters, "legacy");
    assert.equal(client.batches.length, 0, "the legacy entry should not be re-fetched");
  });
});

test("stale subjects are refreshed once a day and patched in place", async () => {
  await withTempCacheDir(async (dir) => {
    await writeCache(dir, {
      subjects: { 1: fakeSubject(1, "old") },
      refreshedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    const client = fakeClient();
    client.updated = [fakeSubject(1, "new"), fakeSubject(99, "not-ours")];

    const result = await getSubjectsCached(client, [1]);

    assert.equal(client.updatedAfterCalls.length, 1);
    assert.equal(result.get(1).data.characters, "new");

    const onDisk = JSON.parse(await readFile(join(dir, "subjects.json"), "utf8"));
    assert.equal(onDisk.subjects["1"].data.characters, "new");
    assert.equal(onDisk.subjects["99"], undefined, "only cached subjects should be patched");
    assert.ok(Date.now() - new Date(onDisk.refreshedAt).getTime() < 60_000);
  });
});

test("a fresh cache is not re-checked against the API", async () => {
  await withTempCacheDir(async (dir) => {
    await writeCache(dir, { subjects: { 1: fakeSubject(1) }, refreshedAt: new Date().toISOString() });
    const client = fakeClient();

    await getSubjectsCached(client, [1]);

    assert.equal(client.updatedAfterCalls.length, 0);
  });
});

test("a failed refresh keeps serving the cache and retries later", async () => {
  await withTempCacheDir(async (dir) => {
    const refreshedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeCache(dir, { subjects: { 1: fakeSubject(1, "old") }, refreshedAt });
    const client = fakeClient();
    client.getSubjectsUpdatedAfter = async () => {
      throw new Error("503 Service Unavailable");
    };

    const result = await getSubjectsCached(client, [1]);

    assert.equal(result.get(1).data.characters, "old");
    const onDisk = JSON.parse(await readFile(join(dir, "subjects.json"), "utf8"));
    assert.equal(onDisk.refreshedAt, refreshedAt, "the clock should not advance on failure");
  });
});

test("a corrupt cache file falls back to fetching rather than crashing", async () => {
  await withTempCacheDir(async (dir) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "subjects.json"), '{"subjects": {"1": ');
    const client = fakeClient();

    const result = await getSubjectsCached(client, [1]);

    assert.equal(result.get(1).data.characters, "subj-1");
  });
});
