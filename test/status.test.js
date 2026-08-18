import { test } from "node:test";
import assert from "node:assert/strict";
import { statusCommand } from "../lib/commands/status.js";
import { saveQueueOrder, recordGrade } from "../lib/queueOrder.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

/**
 * The question this answers is "did that actually go anywhere?", and it kept
 * being answered by guessing. A session that had lost four batches to its own
 * `queue` calls told the user the CLI was unreliable and the rest of the
 * reviews should be done on the website; every fact needed to say what had
 * really happened was sitting in the file this reads.
 */

const BATCH = [
  { assignmentId: 1, subjectId: 11 },
  { assignmentId: 2, subjectId: 12 },
  { assignmentId: 3, subjectId: 13 },
];

const status = (options = {}) => captureStdout(() => statusCommand(options));

test("with nothing on disk it says so, rather than nothing at all", async () => {
  const out = await withTempCacheDir(() => status());

  assert.match(out, /No sitting on disk/);
  assert.match(out, /`queue --limit 10`/);
});

test("a batch part-way through is reported as asked, answered and open", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder(BATCH, { served: [1, 2, 3], totals: { submitted: 30, perfect: 25 } });
    await recordGrade(1, { wrongMeaning: 1 });
    await recordGrade(2, { awaiting: "reading" });

    const out = await status();

    assert.match(out, /Batch: 3 asked · 1 answered · 2 still open \(2, 3\)/);
    assert.match(out, /On record and not sent: 1 answer, 1 carrying a miss/);
    assert.match(out, /Sent this sitting: 30 submitted, 25 perfect/);
    assert.match(out, /`prompts` re-asks the 2 still open, then `submit-batch` sends the 1 on record/);
  });
});

test("an answered batch is told to submit, and nothing else", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder(BATCH, { served: [1, 2, 3] });
    for (const assignmentId of [1, 2, 3]) await recordGrade(assignmentId, {});

    const out = await status();

    assert.match(out, /Next: `submit-batch` sends the 3 on record\./);
    assert.doesNotMatch(out, /prompts/);
  });
});

test("a submitted batch points at the next fetch", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder(BATCH, { served: [] });

    const out = await status();

    assert.match(out, /On record and not sent: nothing/);
    assert.match(out, /Next: `queue --limit 10` fetches the next batch/);
  });
});

test("a sitting past its life says what the next fetch will drop", async () => {
  await withTempCacheDir(async () => {
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await saveQueueOrder(BATCH, { fetchedAt: stale, served: [1, 2, 3] });
    await recordGrade(1, { wrongMeaning: 1 });
    // saveQueueOrder stamps touchedAt as now; age it the way the clock would.
    const { readFile, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const file = join(process.env.WANIKANI_CACHE_DIR, "queue-order.json");
    const raw = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...raw, touchedAt: stale }));

    const out = await status();

    assert.match(out, /idle 3h, past its 30-minute life/);
    assert.match(out, /drops what's on this record \(1 answer\) — those items stay due/);
    assert.match(out, /Next: `queue --limit 10` starts a fresh sitting\./);
  });
});

test("every report ends with what the record can and can't have done", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder(BATCH, { served: [1, 2, 3] });
    await recordGrade(1, {});

    const out = await status();

    assert.match(out, /Nothing reaches WaniKani until `submit-batch`/);
    assert.match(out, /an item stays due until it's submitted/);
  });
});

test("--json gives the same state as fields", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder(BATCH, { served: [1, 2, 3] });
    await recordGrade(1, { wrongReading: 1 });

    const state = JSON.parse(await status({ json: true }));

    assert.equal(state.sitting, true);
    assert.equal(state.due, 3);
    assert.equal(state.asked, 3);
    assert.equal(state.onRecord, 1);
    assert.equal(state.withMiss, 1);
    assert.equal(state.open, 2);
    assert.deepEqual(state.openPositions, [2, 3]);
  });
});
