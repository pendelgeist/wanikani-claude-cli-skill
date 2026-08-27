import { test } from "node:test";
import assert from "node:assert/strict";
import { getReviewQueue, markSubmitted, countRemainingReviews } from "../lib/reviewQueue.js";
import { loadQueueOrder, saveQueueOrder, dropFromQueueOrder, recordGrade, loadGrades } from "../lib/queueOrder.js";
import { writeJsonCache } from "../lib/cacheStore.js";
import { withTempCacheDir } from "./helpers.js";

/** A sitting last touched `minutes` ago — what idleness looks like on disk. */
const idleFor = (minutes, order = {}) =>
  writeJsonCache("queue-order.json", {
    fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    touchedAt: new Date(Date.now() - minutes * 60 * 1000).toISOString(),
    items: [{ assignmentId: 1, subjectId: 2 }],
    totals: { submitted: 0, perfect: 0 },
    grades: {},
    ...order,
  });

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

test("an order left idle is discarded rather than served", async () => {
  await withTempCacheDir(async () => {
    await idleFor(31);

    assert.equal(await loadQueueOrder(), null);
  });
});

test("a sitting still being worked outlives the fetch it came from", async () => {
  // The bug this replaces: the clock ran from the fetch, so a long sitting
  // expired underneath itself — mid-batch, taking the grade record with it.
  await withTempCacheDir(async () => {
    await idleFor(5); // fetched three hours ago, touched five minutes ago

    const order = await loadQueueOrder();
    assert.ok(order, "three hours of work is still one sitting if it never stopped");
    assert.deepEqual(order.items, [{ assignmentId: 1, subjectId: 2 }]);
  });
});

test("grading keeps the sitting alive, and the record with it", async () => {
  await withTempCacheDir(async () => {
    await idleFor(29, { grades: { 1: { wrongMeaning: 0, wrongReading: 1 } } });

    // One more answer, half an hour into a batch: the old clock would have
    // been a minute from voiding everything already recorded.
    await recordGrade(1, { wrongMeaning: 1 });

    assert.deepEqual(await loadGrades(), { 1: { wrongMeaning: 1, wrongReading: 1 } });
    assert.notEqual(await loadQueueOrder(), null);
  });
});

test("pruning keeps the original fetch time, and counts as activity", async () => {
  await withTempCacheDir(async () => {
    const fetchedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await saveQueueOrder([{ assignmentId: 1 }, { assignmentId: 2 }], { fetchedAt });

    const remaining = await dropFromQueueOrder([1]);

    assert.equal(remaining, 1);
    const order = await loadQueueOrder();
    assert.equal(order.fetchedAt, fetchedAt, "provenance is when it was fetched");
    assert.ok(new Date(order.touchedAt).getTime() > new Date(fetchedAt).getTime(), "the clock is not");
  });
});

test("submitting ends the batch, and what went unanswered goes back in the pile", async () => {
  await withTempCacheDir(async () => {
    const { beginBatch, openItems } = await import("../lib/queueOrder.js");
    await saveQueueOrder([
      { assignmentId: 1, subjectId: 11 },
      { assignmentId: 2, subjectId: 12 },
      { assignmentId: 3, subjectId: 13 },
    ]);
    await beginBatch([1, 2]);
    await recordGrade(1, { wrongMeaning: 1 });

    // Only the graded one submits; the batch is over either way.
    await dropFromQueueOrder([1]);

    assert.deepEqual(
      (await openItems()).map((item) => item.assignmentId),
      [2],
      "the unanswered one is still open, and still numbered where it was asked",
    );
    assert.deepEqual(await loadGrades(), {}, "a submitted item's counts don't ride into the next batch");
  });
});

test("without a batch handed out there is nothing to call open", async () => {
  await withTempCacheDir(async () => {
    const { openItems } = await import("../lib/queueOrder.js");
    assert.equal(await openItems(), null, "no sitting at all");

    // A sitting from `review`, or one written before `served` existed: the
    // items are real, but nothing was ever asked out of them.
    await saveQueueOrder([{ assignmentId: 1, subjectId: 11 }]);
    assert.equal(await openItems(), null);
  });
});

test("a sitting that runs out of items keeps its running totals over the refetch", async () => {
  await withTempCacheDir(async () => {
    const { addSessionTotals, loadSitting } = await import("../lib/queueOrder.js");
    const client = fakeClient(2);

    const batch = await getReviewQueue(client, { limit: 2 });
    await addSessionTotals({ submitted: 2, perfect: 1 });
    await markSubmitted(batch.map((item) => item.assignmentId));

    // The list is empty but the sitting is minutes old — more reviews came due
    // while they were working, and this is the same sitting picking them up.
    // The totals used to be reset by the refetch, so a sitting that had
    // reported "79 done this sitting" reported the very next batch as ten.
    await getReviewQueue(client, { limit: 2 });

    assert.deepEqual((await loadSitting()).totals, { submitted: 2, perfect: 1 });
  });
});

test("a break long enough to want fresh items is not long enough to be a new sitting", async () => {
  await withTempCacheDir(async () => {
    const { loadSitting } = await import("../lib/queueOrder.js");
    // Forty items in, the user steps away for the next hour's reviews to
    // unlock. The list ages out at thirty minutes so those get picked up —
    // and the scoreboard used to go with it: they came back to "10 done, 8
    // perfect" with no sitting line at all, and the tally at the end was
    // short by ten items.
    await idleFor(45, { items: [{ assignmentId: 900, subjectId: 2 }], totals: { submitted: 40, perfect: 30 } });

    await getReviewQueue(fakeClient(2), { limit: 2 });

    assert.deepEqual((await loadSitting()).totals, { submitted: 40, perfect: 30 }, "the counter carries");
  });
});

test("a sitting that has really expired starts its totals over", async () => {
  await withTempCacheDir(async () => {
    const { loadSitting } = await import("../lib/queueOrder.js");
    await idleFor(4 * 60, { items: [], totals: { submitted: 40, perfect: 30 } });

    await getReviewQueue(fakeClient(2), { limit: 2 });

    assert.deepEqual((await loadSitting()).totals, { submitted: 0, perfect: 0 }, "a new sitting counts from zero");
  });
});

test("a miss waiting to be submitted does not survive the break the totals do", async () => {
  await withTempCacheDir(async () => {
    const { loadPriorGrades, loadSitting } = await import("../lib/queueOrder.js");
    // The carried miss belongs to an item asked, missed and asked again
    // without ever being sent. Half an hour later with the user elsewhere,
    // the next attempt at it is a fresh one — the same caution `beginBatch`
    // takes about `grades`, which was demoting items an hour after the fact.
    await idleFor(45, {
      items: [],
      totals: { submitted: 4, perfect: 3 },
      priorGrades: { 900: { wrongMeaning: 1, wrongReading: 0 } },
    });

    await getReviewQueue(fakeClient(2), { limit: 2 });

    assert.deepEqual((await loadSitting()).totals, { submitted: 4, perfect: 3 });
    assert.deepEqual(await loadPriorGrades(), {}, "the unsent miss does not");
  });
});

test("reviews that came due mid-sitting are counted, and counted once", async () => {
  await withTempCacheDir(async () => {
    const { takeNewlyDue } = await import("../lib/queueOrder.js");
    // One left on the old list; the fetch finds three. Two of them are new,
    // which is the whole reason "what's left" can go up rather than down.
    await idleFor(45, { items: [{ assignmentId: 100, subjectId: 200 }], totals: { submitted: 2, perfect: 2 } });

    await getReviewQueue(fakeClient(3), { limit: 3 });

    assert.equal(await takeNewlyDue(), 2);
    assert.equal(await takeNewlyDue(), 0, "read once — it belongs to the batch it arrived with");
  });
});

test("a sitting that finished its list doesn't call the whole next fetch new", async () => {
  await withTempCacheDir(async () => {
    const { takeNewlyDue } = await import("../lib/queueOrder.js");
    // The shape a sitting is left in when its last batch submits: the list is
    // empty, and the only record of what was still due is the count it last
    // reported. A sitting resumed from here fetched forty-seven and announced
    // all forty-seven as newly due, on the opening question of the sitting,
    // when thirty-one of them had been waiting the whole time.
    await idleFor(45, {
      items: [],
      totals: { submitted: 47, perfect: 36 },
      lastRemaining: 31,
    });

    await getReviewQueue(fakeClient(47), { limit: 10 });

    assert.equal(await takeNewlyDue(), 16, "forty-seven due against thirty-one known is sixteen that arrived");
  });
});

test("an emptied list with no count behind it claims nothing", async () => {
  await withTempCacheDir(async () => {
    const { takeNewlyDue } = await import("../lib/queueOrder.js");
    // Same shape, but nothing was ever reported — an older sitting on disk,
    // or one that never got as far as a submit. Saying nothing beats saying
    // that every review due is a review that just arrived.
    await idleFor(45, { items: [], totals: { submitted: 4, perfect: 4 } });

    await getReviewQueue(fakeClient(20), { limit: 10 });

    assert.equal(await takeNewlyDue(), 0);
  });
});

test("the first fetch of a sitting has nothing to have come due since", async () => {
  await withTempCacheDir(async () => {
    const { takeNewlyDue } = await import("../lib/queueOrder.js");

    await getReviewQueue(fakeClient(3), { limit: 3 });

    assert.equal(await takeNewlyDue(), 0, "three due at the start is not three that arrived");
  });
});

test("countRemainingReviews uses the cached order, then asks the API once it is empty", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient(3);

    const batch = await getReviewQueue(client, { limit: 2 });
    assert.deepEqual(await countRemainingReviews(client), { remaining: 3, unfetched: false });
    assert.equal(client.assignmentCalls, 1, "a cached order should answer for free");

    await markSubmitted(batch.map((item) => item.assignmentId));
    assert.deepEqual(await countRemainingReviews(client), { remaining: 1, unfetched: false });

    const rest = await getReviewQueue(client, { limit: 10 });
    await markSubmitted(rest.map((item) => item.assignmentId));

    // Order exhausted — this one has to go and look, which is also how
    // reviews unlocked mid-session get noticed. Everything it finds is by
    // definition newer than the fetch that emptied the list, and `unfetched`
    // is what lets the batch summary say so instead of leaving "7 left" and
    // "31 left" seven items apart to be explained in prose.
    assert.deepEqual(await countRemainingReviews(client), { remaining: 3, unfetched: true });
    assert.equal(client.assignmentCalls, 2);
  });
});

test("a count with no sitting behind it doesn't claim anything came due", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient(3);

    // Nothing fetched, so there is no fetch for these to be newer than. The
    // same holds for a sitting that aged out: its unsubmitted items would be
    // counted here, and calling them newly due would be a guess.
    assert.deepEqual(await countRemainingReviews(client), { remaining: 3, unfetched: false });
  });
});

test("queue items arrive with a prompt and correction lines already composed", async () => {
  await withTempCacheDir(async () => {
    const { queueCommand } = await import("../lib/commands/queue.js");
    const { captureStdout } = await import("./helpers.js");

    const output = await captureStdout(() => queueCommand(fakeClient(3), { limit: 3, answers: true }));
    const items = JSON.parse(output);

    assert.deepEqual(
      items.map((item) => item.prompt),
      items.map((item, index) => `${index + 1}. ${item.characters} (${item.subjectType})`),
      "numbered in the order they'll be asked, characters and the kind of subject",
    );
    for (const item of items) {
      assert.doesNotMatch(item.prompt.replace(/ \([a-z ]+\)$/, ""), /[A-Za-z]/, "no gloss past the type");
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
