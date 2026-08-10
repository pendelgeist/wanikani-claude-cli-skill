import { test } from "node:test";
import assert from "node:assert/strict";
import { lessonsCommand } from "../lib/commands/lessons.js";
import { startCommand } from "../lib/commands/start.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

const RADICAL = {
  id: 10,
  object: "radical",
  data: {
    level: 2,
    lesson_position: 1,
    characters: null,
    character_images: [{ url: "https://img/hook.png", content_type: "image/png", metadata: {} }],
    document_url: "https://www.wanikani.com/radicals/hook",
    meanings: [{ meaning: "Hook", primary: true, accepted_answer: true }],
    meaning_mnemonic: "A <radical>hook</radical> hangs there.",
  },
};

const KANJI = {
  id: 11,
  object: "kanji",
  data: {
    level: 1,
    lesson_position: 5,
    characters: "山",
    document_url: "https://www.wanikani.com/kanji/山",
    meanings: [{ meaning: "Mountain", primary: true, accepted_answer: true }],
    readings: [{ reading: "さん", primary: true, accepted_answer: true, type: "onyomi" }],
    meaning_mnemonic: "Three peaks make a <kanji>mountain</kanji>.",
    meaning_hint: "Picture it.",
    reading_mnemonic: "Say <ja>さん</ja>.",
    reading_hint: "Like counting.",
  },
};

function fakeClient(subjects = [KANJI, RADICAL], { failOn = [], failureStatus = 422 } = {}) {
  const client = {
    started: [],
    async getAssignments() {
      return subjects.map((subject, index) => ({ id: 500 + index, data: { subject_id: subject.id } }));
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, subjects.find((s) => s.id === id)]));
    },
    async startAssignment(assignmentId) {
      if (failOn.includes(assignmentId)) {
        const err = new Error(`${failureStatus} Unprocessable Entity`);
        err.status = failureStatus;
        throw err;
      }
      client.started.push(assignmentId);
      return {
        data: {
          started_at: "2026-08-10T12:00:00.000Z",
          srs_stage: 1,
          available_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        },
      };
    },
  };
  return client;
}

test("lessons --json carries the assignment id needed to start each one", async () => {
  await withTempCacheDir(async () => {
    const output = await captureStdout(() => lessonsCommand(fakeClient(), { json: true }));
    const lessons = JSON.parse(output);

    assert.equal(lessons.length, 2);
    assert.deepEqual(
      lessons.map((lesson) => lesson.assignmentId).sort(),
      [500, 501],
      "without these the CLI has no way to mark a lesson started",
    );
  });
});

test("lessons --json teaches everything, mnemonic markup stripped", async () => {
  await withTempCacheDir(async () => {
    const output = await captureStdout(() => lessonsCommand(fakeClient([KANJI]), { json: true }));
    const [lesson] = JSON.parse(output);

    assert.equal(lesson.characters, "山");
    assert.equal(lesson.readings[0].reading, "さん");
    assert.equal(lesson.meaningMnemonic, "Three peaks make a mountain.");
    assert.equal(lesson.readingMnemonic, "Say さん.");
    assert.equal(lesson.meaningHint, "Picture it.");
  });
});

test("a glyph-less radical lesson carries its image instead of characters", async () => {
  await withTempCacheDir(async () => {
    const output = await captureStdout(() => lessonsCommand(fakeClient([RADICAL]), { json: true }));
    const [lesson] = JSON.parse(output);

    assert.equal(lesson.characters, null);
    assert.equal(lesson.characterImageUrl, "https://img/hook.png");
    assert.deepEqual(lesson.readings, [], "radicals have no reading to teach");
  });
});

test("lessons are ordered the way WaniKani teaches them", async () => {
  await withTempCacheDir(async () => {
    const output = await captureStdout(() => lessonsCommand(fakeClient(), { json: true }));
    const lessons = JSON.parse(output);

    assert.deepEqual(
      lessons.map((lesson) => lesson.level),
      [1, 2],
    );
  });
});

test("--limit trims the batch", async () => {
  await withTempCacheDir(async () => {
    const output = await captureStdout(() => lessonsCommand(fakeClient(), { json: true, limit: 1 }));
    assert.equal(JSON.parse(output).length, 1);
  });
});

test("lessons --json returns an empty array when there's nothing to learn", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    client.getAssignments = async () => [];

    const output = await captureStdout(() => lessonsCommand(client, { json: true }));
    assert.deepEqual(JSON.parse(output), []);
  });
});

test("start marks each assignment started and reports the first review time", async () => {
  const client = fakeClient();

  const output = await captureStdout(() => startCommand(client, { assignmentIds: [500, 501] }));
  const { results, batch } = JSON.parse(output);

  assert.deepEqual(client.started, [500, 501]);
  assert.equal(batch.started, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].srsStageName, "Apprentice 1");
  assert.equal(results[0].firstReviewIn, "4h");
});

test("start keeps going after a per-item failure", async () => {
  const client = fakeClient([KANJI, RADICAL], { failOn: [501] });

  const output = await captureStdout(() => startCommand(client, { assignmentIds: [500, 501, 502] }));
  const { results, batch } = JSON.parse(output);

  assert.equal(batch.started, 2);
  assert.equal(batch.failed, 1);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].retryable, false, "422 means already started — retrying can't help");
  assert.deepEqual(client.started, [500, 502]);
});

test("start flags a server-side failure as worth retrying", async () => {
  const client = fakeClient([KANJI], { failOn: [500], failureStatus: 503 });

  const output = await captureStdout(() => startCommand(client, { assignmentIds: [500] }));

  assert.equal(JSON.parse(output).results[0].retryable, true);
});
