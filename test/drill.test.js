import { test } from "node:test";
import assert from "node:assert/strict";
import { drillCommand, NO_MISSES } from "../lib/commands/drill.js";
import { gradeCommand } from "../lib/commands/grade.js";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";
import { saveQueueOrder, recordGrade } from "../lib/queueOrder.js";
import { loadMisses } from "../lib/misses.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

/**
 * "Let's re-review my recent mistakes" is a normal request that had no answer
 * here, so the session asked reconstructed nineteen items from the chat log
 * and graded them from memory. Everything it needed was in the record.
 */

const KANJI = {
  id: 3,
  object: "kanji",
  data: {
    level: 2,
    characters: "親",
    document_url: "https://www.wanikani.com/kanji/親",
    meanings: [{ meaning: "Parent", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [{ type: "onyomi", primary: true, accepted_answer: true, reading: "しん" }],
  },
};

const RADICAL = {
  id: 5,
  object: "radical",
  data: {
    level: 1,
    characters: "亅",
    document_url: "https://www.wanikani.com/radicals/hook",
    meanings: [{ meaning: "Hook", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
  },
};

const client = {
  submitted: [],
  async getSubjectsByIds(ids) {
    return new Map(ids.map((id) => [id, [KANJI, RADICAL].find((s) => s.id === id)]).filter(([, s]) => s));
  },
  async submitReview() {
    return { data: { starting_srs_stage: 4, ending_srs_stage: 3 } };
  },
  async getAssignments() {
    return [];
  },
};

/** One batch answered — the kanji missed, the radical clean — and submitted. */
async function aSubmittedBatch() {
  await saveQueueOrder(
    [
      { assignmentId: 1, subjectId: 3 },
      { assignmentId: 2, subjectId: 5 },
    ],
    { served: [1, 2] },
  );
  await recordGrade(1, { wrongMeaning: 1, wrongReading: 1 });
  await recordGrade(2, {});
  await captureStdout(() => submitBatchCommand(client));
}

test("with nothing missed yet it says where the list comes from", async () => {
  const out = await withTempCacheDir(() => captureStdout(() => drillCommand(client)));

  assert.equal(out.trimEnd(), NO_MISSES);
});

test("submitting files what was missed, and only what was missed", async () => {
  await withTempCacheDir(async () => {
    await aSubmittedBatch();

    const misses = await loadMisses();

    assert.equal(misses.length, 1, "the clean item isn't a mistake");
    assert.equal(misses[0].subjectId, 3);
    assert.deepEqual([misses[0].missedMeaning, misses[0].missedReading], [true, true]);
  });
});

test("the drill asks the questions and hands over no answers", async () => {
  await withTempCacheDir(async () => {
    await aSubmittedBatch();

    const [item] = JSON.parse(await captureStdout(() => drillCommand(client)));

    assert.equal(item.prompt, "1. 親");
    assert.equal(item.subjectId, 3);
    assert.match(item.drill, /none of these are due and none of them submit/);
    assert.doesNotMatch(JSON.stringify(item), /Parent|しん/, "no answer, in any field");
  });
});

test("a drilled answer is graded the same way and says it isn't recording", async () => {
  await withTempCacheDir(async () => {
    await aSubmittedBatch();

    const out = (
      await captureStdout(() => gradeCommand(client, { subjectId: 3, answer: "parent, shin" }))
    ).trimEnd();

    assert.equal(out, "✓\n(drill — nothing recorded, nothing submitted)");
  });
});

test("an item outside the batch that isn't a recent miss is still a warning", async () => {
  await withTempCacheDir(async () => {
    await saveQueueOrder([{ assignmentId: 9, subjectId: 5 }], { served: [9] });

    const out = await captureStdout(() => gradeCommand(client, { subjectId: 3, answer: "parent, shin" }));

    assert.match(out, /NOT RECORDED/);
  });
});

test("missing the same item again moves it up rather than listing it twice", async () => {
  await withTempCacheDir(async () => {
    await aSubmittedBatch();
    await aSubmittedBatch();

    const misses = await loadMisses();

    assert.equal(misses.length, 1);
  });
});
