import { test } from "node:test";
import assert from "node:assert/strict";
import { queueCommand } from "../lib/commands/queue.js";
import { gradeCommand } from "../lib/commands/grade.js";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";
import { loadGrades, loadQueueOrder } from "../lib/queueOrder.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

/**
 * The whole review loop, once, against fakes: fetch a batch, answer each item
 * the way a person would, submit what was graded. Every piece here is unit
 * tested elsewhere — what isn't, until now, is the seam: that the subjectId
 * `queue` prints is the one `grade` takes, that the assignment it records
 * under is the one `submit-batch` submits, and that the record is spent
 * afterwards rather than left to double up.
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
    readings: [
      { type: "onyomi", primary: true, accepted_answer: true, reading: "しん" },
      { type: "kunyomi", primary: false, accepted_answer: false, reading: "おや" },
    ],
  },
};

const VOCAB = {
  id: 4,
  object: "vocabulary",
  data: {
    level: 3,
    characters: "心強い",
    document_url: "https://www.wanikani.com/vocabulary/心強い",
    meanings: [{ meaning: "Reassuring", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [{ primary: true, accepted_answer: true, reading: "こころづよい" }],
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

const SUBJECTS = [KANJI, VOCAB, RADICAL];

function fakeClient() {
  const client = {
    submitted: [],
    async getAssignments() {
      return SUBJECTS.map((subject, index) => ({ id: 100 + index, data: { subject_id: subject.id } }));
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, SUBJECTS.find((s) => s.id === id)]).filter(([, s]) => s));
    },
    async submitReview(review) {
      client.submitted.push(review);
      return { data: { starting_srs_stage: 4, ending_srs_stage: 5 } };
    },
  };
  return client;
}

const json = async (fn) => JSON.parse(await captureStdout(fn));
const gradeJson = (client, options) =>
  json(() => gradeCommand(client, { ...options, json: true }));

test("a batch goes queue → grade → submit-batch --graded with nothing carried by hand", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const batch = await json(() => queueCommand(client, { limit: 3 }));
    assert.equal(batch.length, 3);
    const bySubject = new Map(batch.map((item) => [item.subjectId, item]));

    // 親: a real reading, but not the one wanted — a re-prompt, then right.
    const nudged = await gradeJson(client, { subjectId: 3, answer: "parent, oya" });
    assert.equal(nudged.open, true);
    assert.equal(nudged.assignmentId, bySubject.get(3).assignmentId, "same assignment the queue named");
    await gradeJson(client, { subjectId: 3, reading: "shin" });

    // 心強い: meaning right, reading missed, then given.
    await gradeJson(client, { subjectId: 4, answer: "reassuring, kokorozuyoi" });
    await gradeJson(client, { subjectId: 4, reading: "kokorodzuyoi" });

    // 亅: meaning only, straight through.
    const radical = await gradeJson(client, { subjectId: 5, answer: "hook" });
    assert.equal(radical.say, null);

    const submitted = await json(() => submitBatchCommand(client));

    assert.deepEqual(
      client.submitted.map((review) => [
        review.assignmentId,
        review.incorrectMeaningAnswers,
        review.incorrectReadingAnswers,
      ]),
      [
        [bySubject.get(3).assignmentId, 0, 0], // the re-prompt cost nothing
        [bySubject.get(4).assignmentId, 0, 1], // ず for づ is a real miss
        [bySubject.get(5).assignmentId, 0, 0],
      ],
    );
    assert.match(submitted.summaryLine, /^3 done, 2 perfect/);
    assert.deepEqual(await loadGrades(), {}, "the record is spent, not left to double up");
    assert.deepEqual((await loadQueueOrder()).items, [], "and the batch is out of the queue");
  });
});

test("an overruled miss is submitted as forgiven, not as recorded", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));

    // "parnet" — a typo the answer key can't forgive but a reader can.
    const typo = await gradeJson(client, { subjectId: 3, answer: "parnet, shin" });
    assert.equal(typo.meaning, "incorrect");
    await gradeJson(client, { subjectId: 3, forgive: "meaning" });

    await json(() => submitBatchCommand(client));

    assert.deepEqual(client.submitted[0], {
      assignmentId: 100,
      incorrectMeaningAnswers: 0,
      incorrectReadingAnswers: 0,
    });
  });
});

test("submitting nothing recorded says so instead of reporting an empty batch", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));

    // The sitting aged out, or nothing was graded: either way "0 done, 0
    // perfect" would read like a batch that went through.
    const out = await json(() => submitBatchCommand(client));

    assert.match(out.summaryLine, /Nothing submitted — no grades on record/);
    assert.match(out.summaryLine, /stay due/);
    assert.deepEqual(client.submitted, []);
  });
});

test("an item that failed to submit keeps its counts for the retry", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));
    await gradeJson(client, { subjectId: 3, answer: "parent, mi" });
    client.submitReview = async () => {
      const err = new Error("503 Service Unavailable");
      err.status = 503;
      throw err;
    };

    const out = await json(() => submitBatchCommand(client));

    assert.equal(out.results[0].retryable, true);
    assert.deepEqual(
      await loadGrades(),
      { 100: { wrongMeaning: 0, wrongReading: 1 } },
      "the miss survives with the item, so the retry submits what actually happened",
    );
  });
});

test("answering the two halves in two turns is one item, not two misses", async () => {
  // The item asks "Reading?", they type the reading, and that used to be read
  // as a *meaning* — a right answer scored as two wrong ones, on the most
  // ordinary exchange there is.
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));

    const asked = await gradeJson(client, { subjectId: 3, answer: "parent" });
    assert.equal(asked.say, "Reading?");

    const answered = await gradeJson(client, { subjectId: 3, answer: "shin" });
    assert.deepEqual([answered.meaning, answered.reading], [null, "correct"]);
    assert.equal(answered.say, null);

    await json(() => submitBatchCommand(client));

    assert.deepEqual(client.submitted, [
      { assignmentId: 100, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 },
    ]);
  });
});

test("a bare follow-up that's wrong is a missed reading, not a missed meaning", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));
    await gradeJson(client, { subjectId: 3, answer: "parent" });

    const answered = await gradeJson(client, { subjectId: 3, answer: "mi" });

    assert.deepEqual([answered.wrongMeaning, answered.wrongReading], [0, 1]);
    assert.match(answered.say, /^reading is しん/);
  });
});

test("resending both halves after the question still works", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));
    await gradeJson(client, { subjectId: 3, answer: "parent" });

    const answered = await gradeJson(client, { subjectId: 3, answer: "parent shin" });

    assert.deepEqual([answered.meaning, answered.reading], ["correct", "correct"]);
  });
});
