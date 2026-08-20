import { test } from "node:test";
import assert from "node:assert/strict";
import { askCommand, answerCommand } from "../lib/commands/session.js";
import { loadGrades, openItems } from "../lib/queueOrder.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

/**
 * A whole batch driven the way a session drives it: `ask`, then `answer` with
 * whatever the user typed, and nothing else. No subject ids, no assignment
 * ids, no batch counter, no decision about when to submit — the point of this
 * pair is that none of those reach the driver, so the test refuses to use them
 * too. It answers by reading the printed prompt, exactly as a person would.
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
const RIGHT = { 親: "parent, shin", 心強い: "reassuring, kokoroduyoi", 亅: "hook" };

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

const ask = (client) => captureStdout(() => askCommand(client, { limit: 3 }));
const answer = (client, reply) => captureStdout(() => answerCommand(client, { reply }));

/** The glyph in a printed prompt — how a person knows what they're answering. */
const glyphOf = (output) => Object.keys(RIGHT).find((characters) => output.includes(characters));

test("ask starts a batch and prints the question, and answer needs no id to grade it", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const opening = await ask(client);
    assert.match(opening, /Meaning and reading together on one line/, "the convention, once");
    const glyph = glyphOf(opening);
    assert.ok(glyph, `a question with an item in it, got: ${opening}`);
    assert.match(opening, new RegExp(`^1\\. ${glyph}$`, "m"), "numbered, and nothing else on the line");

    const verdict = await answer(client, RIGHT[glyph]);
    assert.match(verdict, /^✓$/m);
    assert.match(verdict, /^2\. /m, "the next question comes with the verdict");
  });
});

test("answer grades against whatever is open, in the order the batch was served", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    const asked = [];
    for (let position = 1; position <= 3; position += 1) {
      const glyph = glyphOf(output);
      asked.push(glyph);
      output = await answer(client, RIGHT[glyph]);
    }

    assert.equal(new Set(asked).size, 3, "each item asked once, none repeated");
    assert.equal(Object.keys(await loadGrades()).length, 3, "and all three on the record");
  });
});

test("a finished batch is submitted by the next ask, with nobody deciding to", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    for (let position = 1; position <= 3; position += 1) {
      output = await answer(client, RIGHT[glyphOf(output)]);
    }

    // Not on the last answer: a miss there has to stay overrulable, and
    // `--forgive` can't reach a verdict that has already gone to the API.
    assert.match(output, /that's the batch/);
    assert.equal(client.submitted.length, 0, "nothing has gone to the API yet");

    // Deciding *when* to submit is the decision this removes: one sitting
    // answered thirty items across three batches and submitted none of them.
    const summary = await ask(client);
    assert.match(summary, /3 done, 3 perfect/);
    assert.equal(client.submitted.length, 3);
    assert.deepEqual(await loadGrades(), {}, "and the record is spent, not left to double up");
  });
});

test("the last item of a batch can still be forgiven, because the batch hasn't gone yet", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    for (let position = 1; position <= 2; position += 1) {
      output = await answer(client, RIGHT[glyphOf(output)]);
    }
    // Miss the tenth item — the case an auto-submit on the last answer would
    // have made permanent between one call and the next.
    const missed = await answer(client, "wrong answer entirely");
    assert.match(missed, /^✗ /m);

    await captureStdout(() => answerCommand(client, { forgive: "meaning" }));
    await ask(client);

    assert.equal(client.submitted.length, 3);
    assert.ok(
      client.submitted.every((review) => review.incorrectMeaningAnswers === 0),
      "forgiven before it went, not argued about afterwards",
    );
  });
});

test("a re-prompt leaves the item open, and the next answer lands on the same item", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    // Walk to 親 whatever position the shuffle gave it, answering the rest right.
    let output = await ask(client);
    while (glyphOf(output) !== "親") output = await answer(client, RIGHT[glyphOf(output)]);

    // おや is a real reading of 親 — the website shakes and asks again.
    const nudged = await answer(client, "parent, oya");
    assert.match(nudged, /on'yomi/, "it names the type it wants");
    assert.doesNotMatch(nudged, /しん/, "and not the reading itself — the item is still live");
    assert.match(nudged, /same item — still their turn/);

    const open = await openItems();
    assert.equal(open[0].subjectId, 3, "still first in line");
    assert.equal(open[0].awaiting, "reading");

    // A bare reading, the natural thing to type next, graded against 親.
    const closed = await answer(client, "shin");
    assert.match(closed, /^✓$/m);
  });
});

test("ask re-asks the open item rather than serving a new one", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const opening = await ask(client);
    const glyph = glyphOf(opening);

    const again = await ask(client);
    assert.match(again, new RegExp(`^1\\. ${glyph}$`, "m"), "the same question, at the same number");
    assert.doesNotMatch(again, /Meaning and reading together/, "the convention is said once a sitting");
  });
});

test("ask says a mid-question item is waiting on its reading, not on a fresh answer", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    while (glyphOf(output) !== "親") output = await answer(client, RIGHT[glyphOf(output)]);
    await answer(client, "parent, oya");

    const waiting = await ask(client);
    assert.match(waiting, /親/);
    assert.match(waiting, /^Reading\?$/m, "a prompt alone would be answered with a meaning again");
  });
});

test("answer refuses rather than grading into nothing when no batch has been asked", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const output = await answer(client, "parent, shin");
    assert.match(output, /^! No batch on record/);
    assert.match(output, /`ask`/, "it names the call that fixes it");
    assert.deepEqual(await loadGrades(), {}, "and nothing was recorded");
  });
});

test("--forgive takes back the item just graded, without being told which", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    while (glyphOf(output) !== "心強い")
      output = await answer(client, RIGHT[glyphOf(output)]);

    const missed = await answer(client, "encouraging, kokoroduyoi");
    assert.match(missed, /^✗ /m);

    const forgiven = await captureStdout(() => answerCommand(client, { forgive: "meaning" }));
    assert.match(forgiven, /forgiven \(meaning\)/);

    const grades = Object.values(await loadGrades());
    assert.ok(
      grades.every((grade) => grade.wrongMeaning === 0),
      "the miss came back off the record, not just out of the chat",
    );
  });
});

test("nothing the driver has to hold appears in what ask and answer print", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const opening = await ask(client);
    const verdict = await answer(client, RIGHT[glyphOf(opening)]);

    for (const output of [opening, verdict]) {
      assert.doesNotMatch(
        output,
        /subjectId|assignmentId/,
        "an id here is an id to pass back wrong",
      );
      assert.doesNotMatch(
        output,
        /^\s*[[{]/m,
        "no JSON to read a question out of",
      );
    }
  });
});
