import { test } from "node:test";
import assert from "node:assert/strict";
import { queueCommand } from "../lib/commands/queue.js";
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

async function runQueue(subjects) {
  return withTempCacheDir(async () => {
    const output = await captureStdout(() => queueCommand(fakeClient(subjects)));
    return JSON.parse(output);
  });
}

test("a kanji carries its other readings and the re-prompt that names the type wanted", async () => {
  const [item] = await runQueue([KANJI]);

  assert.deepEqual(item.otherReadings, ["おや", "した"]);
  assert.match(item.readingNudge, /on'yomi/);
  // The re-prompt is not a reveal: no kana, and nothing about the meaning.
  assert.doesNotMatch(item.readingNudge, /しん|Parent/);
});

test("the correction says which reading type WaniKani was after", async () => {
  const [item] = await runQueue([KANJI]);

  assert.equal(item.corrections.reading, "reading is しん (on'yomi)");
});

test("a vocabulary near-miss spelling is not offered as another reading", async () => {
  // こころずよい is listed and rejected by WaniKani, not a second way to read
  // the word — treating it as one would hand out a free retry for ず vs づ.
  const [item] = await runQueue([VOCAB]);

  assert.equal(item.otherReadings, undefined);
  assert.equal(item.readingNudge, undefined);
  assert.equal(item.corrections.reading, "reading is こころづよい");
});
