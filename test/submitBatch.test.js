import { test } from "node:test";
import assert from "node:assert/strict";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";
import { saveQueueOrder, loadQueueOrder } from "../lib/queueOrder.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fakeClient({ stages = { starting: 4, ending: 5 }, failOn = [], failure, due = 0 } = {}) {
  const client = {
    submitted: [],
    async submitReview({ assignmentId, incorrectMeaningAnswers, incorrectReadingAnswers }) {
      if (failOn.includes(assignmentId)) throw failure ?? apiError("404 Not Found", 404);
      client.submitted.push({ assignmentId, incorrectMeaningAnswers, incorrectReadingAnswers });
      return { data: { starting_srs_stage: stages.starting, ending_srs_stage: stages.ending } };
    },
    async getAssignments() {
      return Array.from({ length: due }, (_, i) => ({ id: i, data: { subject_id: i } }));
    },
  };
  return client;
}

test("submitBatchCommand submits each item and reports per-item results", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const output = await captureStdout(() =>
      submitBatchCommand(client, [
        { assignmentId: 1, wrongMeaning: 0, wrongReading: 1 },
        { assignmentId: 2 },
      ]),
    );

    assert.deepEqual(client.submitted, [
      { assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 1 },
      { assignmentId: 2, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 },
    ]);

    const { results, batch } = JSON.parse(output);
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].srsStageName, "Guru 1");
    assert.equal(results[0].perfect, false, "one wrong reading is not a perfect item");
    assert.equal(results[1].perfect, true);
    assert.equal(batch.submitted, 2);
    assert.equal(batch.perfect, 1);
  });
});

test("submitBatchCommand reports the SRS movement worth calling out", async () => {
  await withTempCacheDir(async () => {
    const promotion = await captureStdout(() =>
      submitBatchCommand(fakeClient({ stages: { starting: 4, ending: 5 } }), [{ assignmentId: 1 }]),
    );
    assert.equal(JSON.parse(promotion).results[0].tierChange, "promoted");
    assert.equal(JSON.parse(promotion).batch.promoted, 1);

    const burn = await captureStdout(() =>
      submitBatchCommand(fakeClient({ stages: { starting: 8, ending: 9 } }), [{ assignmentId: 1 }]),
    );
    assert.equal(JSON.parse(burn).results[0].tierChange, "burned");
    assert.equal(JSON.parse(burn).batch.burned, 1);

    const slip = await captureStdout(() =>
      submitBatchCommand(fakeClient({ stages: { starting: 5, ending: 3 } }), [{ assignmentId: 1 }]),
    );
    assert.equal(JSON.parse(slip).results[0].tierChange, "demoted");
    assert.equal(JSON.parse(slip).batch.demoted, 1);

    const within = await captureStdout(() =>
      submitBatchCommand(fakeClient({ stages: { starting: 2, ending: 3 } }), [{ assignmentId: 1 }]),
    );
    assert.equal(JSON.parse(within).results[0].tierChange, null, "moving within a tier is not a highlight");
  });
});

test("submitBatchCommand prints a ready-to-use summary line", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder([
      { assignmentId: 1, subjectId: 11 },
      { assignmentId: 2, subjectId: 12 },
      { assignmentId: 3, subjectId: 13 },
    ]);
    // The characters come from the subject cache, so seed it the way a
    // preceding `queue` call would have.
    const { saveSubjectCache } = await import("../lib/subjectCache.js");
    await saveSubjectCache({
      subjects: new Map([
        ["11", { id: 11, data: { characters: "心強い" } }],
        ["12", { id: 12, data: { characters: "集中" } }],
      ]),
      refreshedAt: new Date().toISOString(),
    });

    const output = await captureStdout(() =>
      submitBatchCommand(fakeClient({ stages: { starting: 8, ending: 9 } }), [
        { assignmentId: 1 },
        { assignmentId: 2 },
      ]),
    );

    const { summaryLine } = JSON.parse(output);
    assert.match(summaryLine, /^2 done, 2 perfect/);
    assert.match(summaryLine, /心強い → Burned, 集中 → Burned/, "named from cache, no API call");
    assert.match(summaryLine, /1 left/);
  });
});

test("the summary line carries a session total once past the first batch", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder([
      { assignmentId: 1, subjectId: 11 },
      { assignmentId: 2, subjectId: 12 },
    ]);

    const first = await captureStdout(() => submitBatchCommand(fakeClient(), [{ assignmentId: 1 }]));
    assert.doesNotMatch(JSON.parse(first).summaryLine, /this session/);

    const second = await captureStdout(() => submitBatchCommand(fakeClient(), [{ assignmentId: 2 }]));
    assert.match(JSON.parse(second).summaryLine, /2 done this session, 2 perfect/);
  });
});

test("submitBatchCommand reports how many reviews are left", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder([{ assignmentId: 1 }, { assignmentId: 2 }, { assignmentId: 3 }]);

    const output = await captureStdout(() =>
      submitBatchCommand(fakeClient(), [{ assignmentId: 1 }, { assignmentId: 2 }]),
    );

    assert.equal(JSON.parse(output).remaining, 1);
  });
});

test("submitBatchCommand keeps going after a per-item failure", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient({ failOn: [2] });

    const output = await captureStdout(() =>
      submitBatchCommand(client, [{ assignmentId: 1 }, { assignmentId: 2 }, { assignmentId: 3 }]),
    );

    const { results, batch } = JSON.parse(output);
    assert.equal(results.length, 3);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.equal(results[1].error, "404 Not Found");
    assert.equal(results[2].ok, true);
    assert.equal(batch.submitted, 2);
    assert.equal(batch.failed, 1);
  });
});

test("an item that failed for a passing reason stays queued for another try", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder([{ assignmentId: 1 }, { assignmentId: 2 }]);
    const client = fakeClient({ failOn: [2], failure: apiError("503 Service Unavailable", 503) });

    const output = await captureStdout(() =>
      submitBatchCommand(client, [{ assignmentId: 1 }, { assignmentId: 2 }]),
    );

    assert.equal(JSON.parse(output).results[1].retryable, true);
    assert.deepEqual((await loadQueueOrder()).items, [{ assignmentId: 2 }]);
  });
});

test("an item rejected outright is dropped instead of being re-quizzed forever", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder([{ assignmentId: 1 }, { assignmentId: 2 }]);
    // 422: WaniKani has already got a review for this assignment (submitted
    // from the website, say) — retrying can only fail the same way.
    const client = fakeClient({ failOn: [2], failure: apiError("422 Unprocessable Entity", 422) });

    const output = await captureStdout(() =>
      submitBatchCommand(client, [{ assignmentId: 1 }, { assignmentId: 2 }]),
    );

    assert.equal(JSON.parse(output).results[1].retryable, false);
    assert.deepEqual((await loadQueueOrder()).items, []);
  });
});
