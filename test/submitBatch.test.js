import { test } from "node:test";
import assert from "node:assert/strict";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";
import { saveQueueOrder, loadQueueOrder, recordGrade, loadGrades, beginBatch } from "../lib/queueOrder.js";
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

/**
 * A batch mid-flight: the queue order it came from, and the counts `grade`
 * recorded while it was answered. There's no other way in — hand-fed counts
 * were removed after a batch went in mis-tallied — so the tests set up the
 * same way a session does.
 */
async function graded(entries, order = null) {
  await saveQueueOrder(
    order ?? entries.map(([assignmentId], index) => ({ assignmentId, subjectId: 10 + index })),
  );
  for (const [assignmentId, counts] of entries) await recordGrade(assignmentId, counts ?? {});
}

test("submitBatchCommand submits what was graded and reports per-item results", async () => {
  await withTempCacheDir(async () => {
    await graded([
      [1, { wrongReading: 1 }],
      [2, {}],
    ]);
    const client = fakeClient();

    const output = await captureStdout(() => submitBatchCommand(client));

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
    assert.deepEqual(await loadGrades(), {}, "the record is spent, not left to double up");
  });
});

test("submitBatchCommand reports the SRS movement worth calling out", async () => {
  const submitWith = async (stages) =>
    withTempCacheDir(async () => {
      await graded([[1, {}]]);
      return JSON.parse(await captureStdout(() => submitBatchCommand(fakeClient({ stages }))));
    });

  const promotion = await submitWith({ starting: 4, ending: 5 });
  assert.equal(promotion.results[0].tierChange, "promoted");
  assert.equal(promotion.batch.promoted, 1);

  const burn = await submitWith({ starting: 8, ending: 9 });
  assert.equal(burn.results[0].tierChange, "burned");
  assert.equal(burn.batch.burned, 1);

  const slip = await submitWith({ starting: 5, ending: 3 });
  assert.equal(slip.results[0].tierChange, "demoted");
  assert.equal(slip.batch.demoted, 1);

  const within = await submitWith({ starting: 2, ending: 3 });
  assert.equal(within.results[0].tierChange, null, "moving within a tier is not a highlight");
});

test("submitBatchCommand prints a ready-to-use summary line", async () => {
  await withTempCacheDir(async () => {
    await graded(
      [
        [1, {}],
        [2, {}],
      ],
      [
        { assignmentId: 1, subjectId: 11 },
        { assignmentId: 2, subjectId: 12 },
        { assignmentId: 3, subjectId: 13 },
      ],
    );
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
      submitBatchCommand(fakeClient({ stages: { starting: 8, ending: 9 } })),
    );

    const { summaryLine } = JSON.parse(output);
    assert.match(summaryLine, /^2 done, 2 perfect/);
    assert.match(summaryLine, /心強い → Burned, 集中 → Burned/, "named from cache, no API call");
    assert.match(summaryLine, /1 left/);
  });
});

test("the summary line carries a session total once past the first batch", async () => {
  await withTempCacheDir(async () => {
    await graded(
      [[1, {}]],
      [
        { assignmentId: 1, subjectId: 11 },
        { assignmentId: 2, subjectId: 12 },
      ],
    );

    const first = await captureStdout(() => submitBatchCommand(fakeClient()));
    assert.doesNotMatch(JSON.parse(first).summaryLine, /this session/);

    await recordGrade(2, {});
    const second = await captureStdout(() => submitBatchCommand(fakeClient()));
    assert.match(JSON.parse(second).summaryLine, /2 done this sitting, 2 perfect/);
  });
});

test("submitBatchCommand reports how many reviews are left", async () => {
  await withTempCacheDir(async () => {
    await graded(
      [
        [1, {}],
        [2, {}],
      ],
      [{ assignmentId: 1 }, { assignmentId: 2 }, { assignmentId: 3 }],
    );

    const output = await captureStdout(() => submitBatchCommand(fakeClient()));

    assert.equal(JSON.parse(output).remaining, 1);
  });
});

test("submitBatchCommand keeps going after a per-item failure", async () => {
  await withTempCacheDir(async () => {
    await graded([[1, {}], [2, {}], [3, {}]]);
    const client = fakeClient({ failOn: [2] });

    const output = await captureStdout(() => submitBatchCommand(client));

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
    await graded([
      [1, {}],
      [2, { wrongReading: 1 }],
    ]);
    const client = fakeClient({ failOn: [2], failure: apiError("503 Service Unavailable", 503) });

    const output = await captureStdout(() => submitBatchCommand(client));

    assert.equal(JSON.parse(output).results[1].retryable, true);
    assert.deepEqual((await loadQueueOrder()).items, [{ assignmentId: 2, subjectId: 11 }]);
    assert.deepEqual(
      await loadGrades(),
      { 2: { wrongMeaning: 0, wrongReading: 1 } },
      "its counts wait with it, so the retry submits what actually happened",
    );
  });
});

test("an item rejected outright is dropped instead of being re-quizzed forever", async () => {
  await withTempCacheDir(async () => {
    await graded([[1, {}], [2, {}]]);
    // 422: WaniKani has already got a review for this assignment (submitted
    // from the website, say) — retrying can only fail the same way.
    const client = fakeClient({ failOn: [2], failure: apiError("422 Unprocessable Entity", 422) });

    const output = await captureStdout(() => submitBatchCommand(client));

    assert.equal(JSON.parse(output).results[1].retryable, false);
    assert.deepEqual((await loadQueueOrder()).items, []);
    assert.deepEqual(await loadGrades(), {}, "and its counts go with it");
  });
});

test("nothing on record is said plainly, and names what records it", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder([{ assignmentId: 1, subjectId: 11 }]);

    const output = await captureStdout(() => submitBatchCommand(fakeClient()));

    const { summaryLine, batch } = JSON.parse(output);
    assert.match(summaryLine, /Nothing submitted — no grades on record/);
    assert.match(summaryLine, /wanikani grade/, "the fix belongs in the message");
    assert.match(summaryLine, /grade 11 /, "with a real id from the sitting, not a placeholder");
    assert.match(summaryLine, /can still be graded now/, "answered items aren't lost");
    assert.match(summaryLine, /stay due/);
    assert.equal(batch.submitted, 0);
  });
});

/** A batch as `queue` hands it out: the order, plus which of it was asked. */
async function servedBatch(items) {
  await saveQueueOrder(items, { served: items.map((item) => item.assignmentId) });
}

test("the batch says how much of it never got answered", async () => {
  // Ten prompts on screen and six answers on record looks identical to ten of
  // each from the outside — one session reported the ten. The gap is knowable
  // here, so the line says it.
  await withTempCacheDir(async () => {
    await servedBatch([
      { assignmentId: 1, subjectId: 11 },
      { assignmentId: 2, subjectId: 12 },
      { assignmentId: 3, subjectId: 13 },
    ]);
    await recordGrade(1, {});

    const output = await captureStdout(() => submitBatchCommand(fakeClient()));

    const { summaryLine } = JSON.parse(output);
    assert.match(summaryLine, /^1 done, 1 perfect · 2 left unanswered — still due/);
  });
});

test("an item still mid-question isn't submitted as a clean pass", async () => {
  // A re-prompt records the attempt so far and waits. Submitting that record
  // would send "nothing wrong here" for a reading nobody has given yet.
  await withTempCacheDir(async () => {
    await servedBatch([
      { assignmentId: 1, subjectId: 11 },
      { assignmentId: 2, subjectId: 12 },
    ]);
    await recordGrade(1, {});
    await recordGrade(2, { awaiting: "reading" });
    const client = fakeClient();

    const output = await captureStdout(() => submitBatchCommand(client));

    assert.deepEqual(client.submitted, [
      { assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 },
    ]);
    assert.match(JSON.parse(output).summaryLine, /1 left unanswered/);
    assert.deepEqual(await loadGrades(), { 2: { wrongMeaning: 0, wrongReading: 0, awaiting: "reading" } });
  });
});

test("a batch that only got as far as a re-prompt says that, not \"nothing graded\"", async () => {
  await withTempCacheDir(async () => {
    await servedBatch([{ assignmentId: 1, subjectId: 11 }]);
    await recordGrade(1, { awaiting: "reading" });

    const output = await captureStdout(() => submitBatchCommand(fakeClient()));

    const { summaryLine } = JSON.parse(output);
    assert.match(summaryLine, /still open/);
    assert.doesNotMatch(summaryLine, /no grades on record/);
  });
});

test("a miss from earlier in the sitting is submitted with the answer that replaced it", async () => {
  await withTempCacheDir(async () => {
    await servedBatch([{ assignmentId: 1, subjectId: 11 }]);
    await recordGrade(1, { wrongMeaning: 1, wrongReading: 1 });
    // The re-ask: `queue` hands the same item out again and clears its record.
    await beginBatch([1]);
    await recordGrade(1, {});
    const client = fakeClient();

    const { summaryLine, batch, results } = JSON.parse(
      await captureStdout(() => submitBatchCommand(client)),
    );

    assert.deepEqual(client.submitted, [
      { assignmentId: 1, incorrectMeaningAnswers: 1, incorrectReadingAnswers: 1 },
    ]);
    assert.equal(results[0].perfect, false);
    assert.equal(results[0].carriedMiss, true);
    assert.equal(batch.carriedMisses, 1);
    assert.match(summaryLine, /1 kept a miss from earlier this sitting/);
  });
});

test("a clean attempt leaves nothing behind to carry", async () => {
  await withTempCacheDir(async () => {
    await servedBatch([{ assignmentId: 1, subjectId: 11 }]);
    await recordGrade(1, {});
    await beginBatch([1]);
    await recordGrade(1, { wrongReading: 1 });

    const client = fakeClient();
    const { batch } = JSON.parse(await captureStdout(() => submitBatchCommand(client)));

    assert.deepEqual(client.submitted, [
      { assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 1 },
    ]);
    assert.equal(batch.carriedMisses, 0);
  });
});

test("a piped-in list is called out in the payload, not only on stderr", async () => {
  // Six batches in one sitting went in with a heredoc of hand-written counts
  // attached. All six were ignored and the submissions were right anyway —
  // and the session never mentioned it, because the warning wasn't in the
  // thing it was reading.
  await withTempCacheDir(async () => {
    await graded([[1, {}]]);

    const output = await captureStdout(() =>
      submitBatchCommand(fakeClient(), { ignoredStdin: true }),
    );

    const { ignoredStdin, batch } = JSON.parse(output);
    assert.match(ignoredStdin, /takes no counts/);
    assert.equal(batch.submitted, 1, "and the submission still goes through on the record");
  });
});
