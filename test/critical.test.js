import { test } from "node:test";
import assert from "node:assert/strict";
import { criticalCommand, nothingCritical } from "../lib/commands/critical.js";
import { gradeCommand } from "../lib/commands/grade.js";
import { loadCritical } from "../lib/critical.js";
import { saveQueueOrder } from "../lib/queueOrder.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

/**
 * "Show me my critical items" sent people to wanikani.com mid-session,
 * because `drill` only knows the misses this tool watched happen — nothing
 * reviewed on the website, and nothing at all on a fresh install. WaniKani
 * keeps the real tally and will hand back everything under a threshold.
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

const VOCAB = {
  id: 7,
  object: "vocabulary",
  data: {
    level: 2,
    characters: "苦労",
    document_url: "https://www.wanikani.com/vocabulary/苦労",
    meanings: [{ meaning: "Hardship", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [{ primary: true, accepted_answer: true, reading: "くろう" }],
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

const stat = (subjectId, subjectType, percentage) => ({
  id: subjectId * 1000,
  object: "review_statistic",
  data: { subject_id: subjectId, subject_type: subjectType, percentage_correct: percentage, hidden: false },
});

/** Deliberately out of order, since the command is what sorts them. */
function clientWith(stats = [stat(7, "vocabulary", 67), stat(3, "kanji", 50), stat(5, "radical", 74)]) {
  return {
    asked: [],
    async getReviewStatistics(params) {
      this.asked.push(params);
      return stats;
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, SUBJECTS.find((s) => s.id === id)]).filter(([, s]) => s));
    },
  };
}

test("it asks WaniKani for the items under the threshold, and leaves out the retired ones", async () => {
  await withTempCacheDir(async () => {
    const client = clientWith();

    await captureStdout(() => criticalCommand(client));

    assert.deepEqual(client.asked, [{ percentages_less_than: 75, hidden: false }]);
  });
});

test("--under moves the line, and the payload says where it was drawn", async () => {
  await withTempCacheDir(async () => {
    const client = clientWith([stat(3, "kanji", 50)]);

    const [item] = JSON.parse(await captureStdout(() => criticalCommand(client, { under: 60 })));

    assert.deepEqual(client.asked, [{ percentages_less_than: 60, hidden: false }]);
    assert.match(item.critical, /under 60%/);
  });
});

test("worst first, whatever order they arrived in", async () => {
  await withTempCacheDir(async () => {
    const payload = JSON.parse(await captureStdout(() => criticalCommand(clientWith())));

    assert.deepEqual(
      payload.map((item) => [item.subjectId, item.percentageCorrect]),
      [
        [3, 50],
        [7, 67],
        [5, 74],
      ],
    );
    assert.deepEqual(
      payload.map((item) => item.prompt),
      ["1. 親", "2. 苦労", "3. 亅"],
    );
  });
});

test("it hands over no answers, same as the queue", async () => {
  await withTempCacheDir(async () => {
    const payload = await captureStdout(() => criticalCommand(clientWith()));

    assert.doesNotMatch(payload, /Parent|しん|Hardship|くろう|Hook/, "no answer, in any field");
  });
});

test("the note says it's a drill, and how many were held back", async () => {
  await withTempCacheDir(async () => {
    const payload = JSON.parse(await captureStdout(() => criticalCommand(clientWith(), { limit: 2 })));

    assert.equal(payload.length, 2);
    assert.match(payload[0].critical, /none of these are due and none of them submit/);
    assert.match(payload[0].critical, /The worst 2 of 3 — `critical-condition --limit 3`/);
    assert.equal(payload[1].critical, undefined, "the note rides the first item only");
  });
});

test("nothing held back means nothing said about it", async () => {
  await withTempCacheDir(async () => {
    const [item] = JSON.parse(await captureStdout(() => criticalCommand(clientWith())));

    assert.doesNotMatch(item.critical, /The worst/);
  });
});

test("with nothing under the threshold it says so rather than printing an empty list", async () => {
  await withTempCacheDir(async () => {
    const out = await captureStdout(() => criticalCommand(clientWith([])));

    assert.equal(out.trimEnd(), nothingCritical(75));
  });
});

test("a critical item graded outside a batch is a drill, not an unrecorded answer", async () => {
  await withTempCacheDir(async () => {
    await captureStdout(() => criticalCommand(clientWith()));

    const out = (
      await captureStdout(() => gradeCommand(clientWith(), { subjectId: 3, answer: "parent, shin" }))
    ).trimEnd();

    assert.equal(out, "✓\n(drill — nothing recorded, nothing submitted)");
  });
});

test("it's still a drill while a sitting is open on other items", async () => {
  await withTempCacheDir(async () => {
    await captureStdout(() => criticalCommand(clientWith()));
    await saveQueueOrder([{ assignmentId: 9, subjectId: 5 }], { served: [9] });

    const out = await captureStdout(() => gradeCommand(clientWith(), { subjectId: 3, answer: "parent, shin" }));

    assert.match(out, /\(drill — nothing recorded, nothing submitted\)/);
    assert.doesNotMatch(out, /NOT RECORDED/);
  });
});

test("an item that climbs back over the line stops counting as a drill", async () => {
  await withTempCacheDir(async () => {
    await captureStdout(() => criticalCommand(clientWith()));
    // Next fetch, and 親 is no longer in critical condition.
    await captureStdout(() => criticalCommand(clientWith([stat(7, "vocabulary", 67)])));

    assert.deepEqual(await loadCritical(), [{ subjectId: 7 }]);

    const out = await captureStdout(() => gradeCommand(clientWith(), { subjectId: 3, answer: "parent, shin" }));

    assert.match(out, /NOT RECORDED/);
  });
});

test("an empty list clears the old one too", async () => {
  await withTempCacheDir(async () => {
    await captureStdout(() => criticalCommand(clientWith()));
    await captureStdout(() => criticalCommand(clientWith([])));

    assert.deepEqual(await loadCritical(), []);
  });
});

test("an item the subjects endpoint can't resolve takes neither the note nor a number with it", async () => {
  await withTempCacheDir(async () => {
    // 99 is in critical condition and has no subject to show for it.
    const client = clientWith([stat(99, "kanji", 40), stat(3, "kanji", 50), stat(7, "vocabulary", 67)]);

    const payload = JSON.parse(await captureStdout(() => criticalCommand(client)));

    assert.deepEqual(
      payload.map((item) => item.prompt),
      ["1. 親", "2. 苦労"],
      "numbered by what's actually on screen",
    );
    assert.match(payload[0].critical, /none of these are due/, "the terms still ride the first item shown");
  });
});

test("a missed drill item doesn't say 'recorded' one line above 'nothing recorded'", async () => {
  await withTempCacheDir(async () => {
    await captureStdout(() => criticalCommand(clientWith()));

    const out = (await captureStdout(() => gradeCommand(clientWith(), { subjectId: 3, answer: "guardian" }))).trimEnd();

    assert.deepEqual(out.split("\n").slice(1), [
      "(next item)",
      "(drill — nothing recorded, nothing submitted)",
    ]);
  });
});
