import { test } from "node:test";
import assert from "node:assert/strict";
import { queueCommand } from "../lib/commands/queue.js";
import { gradeCommand } from "../lib/commands/grade.js";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

/** Backdates the sitting on disk, so the idle timeout can be tested in a millisecond. */
async function ageTheSitting(minutes) {
  const stale = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const file = join(process.env.WANIKANI_CACHE_DIR, "queue-order.json");
  const raw = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...raw, fetchedAt: stale, touchedAt: stale }));
}
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

    // "parrents" — two slips, past what the tolerance forgives on a word this
    // short, and still plainly the right answer to a reader.
    const typo = await gradeJson(client, { subjectId: 3, answer: "parrents, shin" });
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

test("re-fetching over a graded batch is refused, and says which call to make", async () => {
  // The session that needed this graded six items, called `queue` instead of
  // `submit-batch`, got the same ten back — nothing is pruned until it's
  // submitted — and concluded the API was lagging. Thirty answers later it had
  // submitted none of them.
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));
    await gradeJson(client, { subjectId: 3, answer: "wrong, mi" });

    await assert.rejects(() => queueCommand(client, { limit: 3 }), /submit-batch/);
    assert.deepEqual(
      await loadGrades(),
      { 100: { wrongMeaning: 1, wrongReading: 1 } },
      "the refused fetch left the record alone",
    );
  });
});

test("asking an item again discards what an earlier attempt recorded for it", async () => {
  // The failure this prevents: a sitting abandoned mid-batch left grades on
  // disk, the same items were answered correctly an hour later, and
  // `submit-batch` submitted the old attempt — four items demoted for answers
  // nobody gave that day.
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));
    await gradeJson(client, { subjectId: 3, answer: "wrong, mi" });
    assert.deepEqual(await loadGrades(), { 100: { wrongMeaning: 1, wrongReading: 1 } });

    await json(() => queueCommand(client, { limit: 3, restart: true }));

    assert.deepEqual(await loadGrades(), {}, "the re-ask supersedes the abandoned attempt");
    const out = await json(() => submitBatchCommand(client));
    assert.match(out.summaryLine, /Nothing submitted/);
    assert.deepEqual(client.submitted, [], "nothing goes in that this sitting didn't grade");
  });
});

test("a stale sitting's leftovers are dropped without asking", async () => {
  // The refusal is about answers given minutes ago, which are still worth
  // submitting. An abandoned sitting is the other case entirely: the fetch
  // that follows it is a new day's, and there's nothing there to protect.
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));
    await gradeJson(client, { subjectId: 3, answer: "wrong, mi" });
    await ageTheSitting(3 * 60);

    const batch = await json(() => queueCommand(client, { limit: 3 }));

    assert.equal(batch.length, 3, "no refusal, and a fresh batch");
    assert.deepEqual(await loadGrades(), {});
  });
});

test("a fresh answer after a re-ask is the one that counts", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));
    await gradeJson(client, { subjectId: 3, answer: "wrong, mi" });

    await json(() => queueCommand(client, { limit: 3, restart: true }));
    await gradeJson(client, { subjectId: 3, answer: "parent, shin" });
    await json(() => submitBatchCommand(client));

    assert.deepEqual(client.submitted, [
      { assignmentId: 100, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 },
    ]);
  });
});

test("an item answered once doesn't get graded a second time", async () => {
  // Handing over the answer and taking it back is the failure mode: one
  // session followed six corrections with "try X?", the user typed X, and the
  // ✓ it printed contradicted the miss still sitting on the record.
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await json(() => queueCommand(client, { limit: 3 }));
    await gradeJson(client, { subjectId: 3, answer: "wrong, mi" });

    const second = await gradeJson(client, { subjectId: 3, answer: "parent, shin" });

    assert.ok(second.alreadyAnswered, "no verdict on an answer to a settled item");
    assert.match(second.say, /--forgive meaning/);
    assert.deepEqual(await loadGrades(), { 100: { wrongMeaning: 1, wrongReading: 1 } });
    await json(() => submitBatchCommand(client));
    assert.deepEqual(client.submitted, [
      { assignmentId: 100, incorrectMeaningAnswers: 1, incorrectReadingAnswers: 1 },
    ]);
  });
});
