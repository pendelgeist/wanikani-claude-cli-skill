import { test } from "node:test";
import assert from "node:assert/strict";
import { queueCommand } from "../lib/commands/queue.js";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

const KANJI = {
  id: 11,
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
      { type: "kunyomi", primary: false, accepted_answer: false, reading: "した" },
    ],
  },
};

const VOCAB = {
  id: 12,
  object: "vocabulary",
  data: {
    level: 3,
    characters: "心強い",
    document_url: "https://www.wanikani.com/vocabulary/心強い",
    meanings: [{ meaning: "Reassuring", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [
      { reading: "こころづよい", primary: true, accepted_answer: true },
      { reading: "こころずよい", primary: false, accepted_answer: false },
    ],
  },
};

function fakeClient(subjects) {
  return {
    async getAssignments() {
      return subjects.map((subject, index) => ({ id: 800 + index, data: { subject_id: subject.id } }));
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, subjects.find((s) => s.id === id)]));
    },
  };
}

async function runQueue(subjects, options = {}) {
  return withTempCacheDir(async () => {
    const output = await captureStdout(() => queueCommand(fakeClient(subjects), options));
    return JSON.parse(output);
  });
}

test("the queue hands over a question and no way to answer it", async () => {
  // Everything the answer key enabled — hand-written corrections, romaji,
  // invented mnemonics, a self-answered item — came from it being here.
  const [item] = await runQueue([KANJI]);

  assert.deepEqual(Object.keys(item).sort(), [
    "assignmentId",
    "convention",
    "grading",
    "level",
    "needsReading",
    "prompt",
    "subjectId",
    "subjectType",
  ]);
  assert.equal(item.prompt, "1. 親 — meaning & reading?");
  assert.doesNotMatch(JSON.stringify(item), /Parent|しん|おや/, "no answer, in any field");
});

test("--answers puts the key back, for debugging the CLI itself", async () => {
  const [item] = await runQueue([KANJI], { answers: true });

  assert.deepEqual(item.otherReadings, ["おや", "した"]);
  assert.match(item.readingNudge, /on'yomi/);
  // The re-prompt is not a reveal: no kana, and nothing about the meaning.
  assert.doesNotMatch(item.readingNudge, /しん|Parent/);
});

test("the correction says which reading type WaniKani was after", async () => {
  const [item] = await runQueue([KANJI], { answers: true });

  assert.equal(
    item.corrections.reading,
    "reading is しん (on'yomi) · https://jisho.org/search/%E8%A6%AA%20%23kanji",
  );
});

test("a vocabulary near-miss spelling is not offered as another reading", async () => {
  // こころずよい is listed and rejected by WaniKani, not a second way to read
  // the word — treating it as one would hand out a free retry for ず vs づ.
  const [item] = await runQueue([VOCAB], { answers: true });

  assert.equal(item.otherReadings, undefined);
  assert.equal(item.readingNudge, undefined);
  assert.equal(
    item.corrections.reading,
    "reading is こころづよい · https://jisho.org/word/%E5%BF%83%E5%BC%B7%E3%81%84",
  );
});

test("every batch carries the note about where grading happens", async () => {
  // A sitting outlives a conversation, so the once-a-sitting strings can all
  // have been said to somebody else. The session this is for arrived mid-
  // sitting, was handed ten questions with no framing, wrote a script against
  // the WaniKani API to fetch the answer key, graded the batch in chat from
  // it, and then had to grade all ten again through `grade` anyway.
  await withTempCacheDir(async () => {
    const client = fakeClient([KANJI, VOCAB]);
    const first = JSON.parse(await captureStdout(() => queueCommand(client, {})));
    // Answer and submit one, so the next fetch is mid-sitting rather than the
    // start of one — which is where a fresh conversation walks in.
    const { recordGrade } = await import("../lib/queueOrder.js");
    await recordGrade(first[0].assignmentId, {});
    await captureStdout(() =>
      submitBatchCommand({
        ...client,
        async submitReview() {
          return { data: { starting_srs_stage: 4, ending_srs_stage: 5 } };
        },
      }),
    );
    const later = JSON.parse(await captureStdout(() => queueCommand(client, {})));

    assert.match(first[0].grading, /`grade <subjectId>/);
    assert.match(later[0].grading, /`grade <subjectId>/, "said again, mid-sitting");
    assert.equal(later[0].convention, undefined, "unlike the one the user was already told");
    assert.doesNotMatch(JSON.stringify(later), /Parent|しん|おや/, "and still no answers");
  });
});
