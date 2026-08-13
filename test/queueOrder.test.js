import { test } from "node:test";
import assert from "node:assert/strict";
import { getReviewQueue, markSubmitted, countRemainingReviews } from "../lib/reviewQueue.js";
import { loadQueueOrder, saveQueueOrder, dropFromQueueOrder } from "../lib/queueOrder.js";
import { withTempCacheDir } from "./helpers.js";

function fakeSubject(id) {
  return {
    id,
    object: "kanji",
    data: {
      level: 1,
      characters: `字${id}`,
      document_url: `https://www.wanikani.com/kanji/${id}`,
      meanings: [{ meaning: `meaning-${id}`, primary: true, accepted_answer: true }],
      readings: [{ reading: "いち", primary: true, accepted_answer: true }],
    },
  };
}

function fakeClient(dueCount) {
  const client = {
    assignmentCalls: 0,
    async getAssignments() {
      client.assignmentCalls += 1;
      return Array.from({ length: dueCount }, (_, i) => ({ id: 100 + i, data: { subject_id: 200 + i } }));
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, fakeSubject(id)]));
    },
  };
  return client;
}

test("the first batch fetches due assignments live and caches the order", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient(25);

    const batch = await getReviewQueue(client, { limit: 10 });

    assert.equal(batch.length, 10);
    assert.equal(client.assignmentCalls, 1);
    assert.equal((await loadQueueOrder()).items.length, 25);
  });
});

test("a second batch slices the cached order instead of re-fetching", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient(25);

    const first = await getReviewQueue(client, { limit: 10 });
    const second = await getReviewQueue(client, { limit: 10 });

    assert.equal(client.assignmentCalls, 1);
    // Nothing was submitted in between, so the same items are still pending.
    assert.deepEqual(
      second.map((item) => item.assignmentId),
      first.map((item) => item.assignmentId),
    );
  });
});

test("submitting advances the queue to the next, non-overlapping batch", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient(25);

    const first = await getReviewQueue(client, { limit: 10 });
    await markSubmitted(first.map((item) => item.assignmentId));
    const second = await getReviewQueue(client, { limit: 10 });

    assert.equal(client.assignmentCalls, 1);
    const firstIds = new Set(first.map((item) => item.assignmentId));
    assert.equal(
      second.filter((item) => firstIds.has(item.assignmentId)).length,
      0,
      "a submitted item should not come back in the next batch",
    );
  });
});

test("items answered but never submitted stay queued for next time", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient(12);

    const first = await getReviewQueue(client, { limit: 10 });
    // Session interrupted before submit-batch ran: nothing is pruned.
    const afterInterruption = await getReviewQueue(client, { limit: 10 });

    assert.deepEqual(
      afterInterruption.map((item) => item.assignmentId),
      first.map((item) => item.assignmentId),
    );
  });
});

test("the order is re-fetched once it has been worked through", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient(5);

    const batch = await getReviewQueue(client, { limit: 10 });
    await markSubmitted(batch.map((item) => item.assignmentId));
    await getReviewQueue(client, { limit: 10 });

    assert.equal(client.assignmentCalls, 2);
  });
});

test("a stale order is discarded rather than served", async () => {
  await withTempCacheDir(async () => {
    const staleFetchedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await saveQueueOrder([{ assignmentId: 1, subjectId: 2 }], staleFetchedAt);

    assert.equal(await loadQueueOrder(), null);
  });
});

test("pruning keeps the original fetch time so a long session still ages out", async () => {
  await withTempCacheDir(async () => {
    const fetchedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await saveQueueOrder([{ assignmentId: 1 }, { assignmentId: 2 }], fetchedAt);

    const remaining = await dropFromQueueOrder([1]);

    assert.equal(remaining, 1);
    assert.equal((await loadQueueOrder()).fetchedAt, fetchedAt);
  });
});

test("countRemainingReviews uses the cached order, then asks the API once it is empty", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient(3);

    const batch = await getReviewQueue(client, { limit: 2 });
    assert.equal(await countRemainingReviews(client), 3);
    assert.equal(client.assignmentCalls, 1, "a cached order should answer for free");

    await markSubmitted(batch.map((item) => item.assignmentId));
    assert.equal(await countRemainingReviews(client), 1);

    const rest = await getReviewQueue(client, { limit: 10 });
    await markSubmitted(rest.map((item) => item.assignmentId));

    // Order exhausted — this one has to go and look, which is also how
    // reviews unlocked mid-session get noticed.
    assert.equal(await countRemainingReviews(client), 3);
    assert.equal(client.assignmentCalls, 2);
  });
});

test("queue items arrive with a prompt and correction lines already composed", async () => {
  await withTempCacheDir(async () => {
    const { queueCommand } = await import("../lib/commands/queue.js");
    const { captureStdout } = await import("./helpers.js");

    const output = await captureStdout(() => queueCommand(fakeClient(3), { limit: 3 }));
    const items = JSON.parse(output);

    assert.deepEqual(
      items.map((item) => item.prompt),
      items.map((item, index) => `${index + 1}. ${item.characters}`),
      "numbered in the order they'll be asked, characters only",
    );
    for (const item of items) {
      assert.doesNotMatch(item.prompt, /[A-Za-z(]/, "no gloss, no label");
      assert.match(item.corrections.reading, /^reading is [^A-Za-z]+ · https:/);
      assert.match(item.corrections.reading, /https:\/\/jisho\.org\/\S+$/, "the link rides on the line");
    }
  });
});

test("the how-to-answer note rides on the first item, once per sitting", async () => {
  await withTempCacheDir(async () => {
    const { queueCommand } = await import("../lib/commands/queue.js");
    const { captureStdout } = await import("./helpers.js");
    const { addSessionTotals } = await import("../lib/queueOrder.js");
    const client = fakeClient(6);

    const first = JSON.parse(await captureStdout(() => queueCommand(client, { limit: 3 })));
    assert.match(first[0].convention, /one line/, "the start of a sitting explains how to answer");
    assert.equal(first[1].convention, undefined, "and only once");

    // Once a batch has been submitted we're mid-sitting; the note would be noise.
    await markSubmitted(first.map((item) => item.assignmentId));
    await addSessionTotals({ submitted: 3, perfect: 3 });

    const second = JSON.parse(await captureStdout(() => queueCommand(client, { limit: 3 })));
    assert.equal(second[0].convention, undefined);
  });
});
