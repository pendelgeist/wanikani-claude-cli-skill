import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { reviewCommand } from "../lib/commands/review.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

const VOCAB = {
  id: 11,
  object: "vocabulary",
  data: {
    level: 3,
    characters: "心強い",
    document_url: "https://www.wanikani.com/vocabulary/心強い",
    meanings: [{ meaning: "Reassuring", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [{ reading: "こころづよい", primary: true, accepted_answer: true }],
  },
};

const RADICAL = {
  id: 10,
  object: "radical",
  data: {
    level: 1,
    characters: null,
    character_images: [{ url: "https://img/hook.png", content_type: "image/png", metadata: {} }],
    document_url: "https://www.wanikani.com/radicals/hook",
    meanings: [{ meaning: "Hook", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
  },
};

function fakeClient(subject, { stages = { starting: 4, ending: 5 } } = {}) {
  const client = {
    submitted: [],
    async getAssignments() {
      return [{ id: 1, data: { subject_id: subject.id } }];
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, subject]));
    },
    async submitReview(review) {
      client.submitted.push(review);
      return { data: { starting_srs_stage: stages.starting, ending_srs_stage: stages.ending } };
    },
  };
  return client;
}

/** Runs a session against scripted answers, returning everything it printed. */
async function runReview(client, answers) {
  const input = Readable.from(answers.map((line) => `${line}\n`));
  const output = new Writable({
    write(chunk, encoding, done) {
      output.written = (output.written ?? "") + chunk.toString();
      done();
    },
  });

  return withTempCacheDir(async () => {
    const logged = await captureStdout(() => reviewCommand(client, { input, output }));
    return logged + (output.written ?? "");
  });
}

test("a correct meaning and reading are graded and submitted", async () => {
  const client = fakeClient(VOCAB);

  const out = await runReview(client, ["reassuring", "kokorodzuyoi"]);

  assert.deepEqual(client.submitted, [
    { assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 },
  ]);
  assert.match(out, /1 reviewed, 1 perfect/);
});

test("wrong attempts are counted and reported to the API", async () => {
  const client = fakeClient(VOCAB);

  await runReview(client, ["reassuring", "kokorozuyoi", "こころづよい"]);

  assert.deepEqual(client.submitted, [
    { assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 1 },
  ]);
});

test("crossing a tier is called out in the item line and the summary", async () => {
  const burn = await runReview(fakeClient(VOCAB, { stages: { starting: 8, ending: 9 } }), [
    "reassuring",
    "こころづよい",
  ]);
  assert.match(burn, /→ Burned 🔥/);
  assert.match(burn, /1 burned/);

  const slip = await runReview(fakeClient(VOCAB, { stages: { starting: 5, ending: 3 } }), [
    "reassuring",
    "こころづよい",
  ]);
  assert.match(slip, /↓/);
  assert.match(slip, /1 slipped back/);
});

test("a glyph-less radical is shown its image once the answer is in, never before", async () => {
  const out = await runReview(fakeClient(RADICAL), ["hook"]);

  const [beforeAnswer, afterAnswer] = out.split("→ Guru 1");
  assert.doesNotMatch(beforeAnswer, /img\/hook\.png/, "the image is the answer for a no-glyph radical");
  assert.doesNotMatch(beforeAnswer, /Hook/, "and so is the name");
  assert.match(afterAnswer, /https:\/\/img\/hook\.png/);
});

test("a radical is never asked for a reading", async () => {
  const client = fakeClient(RADICAL);

  await runReview(client, ["hook"]);

  assert.equal(client.submitted[0].incorrectReadingAnswers, 0);
});

test(":quit stops the session, leaving the unanswered item unsubmitted", async () => {
  const client = fakeClient(VOCAB);

  const out = await runReview(client, [":quit"]);

  assert.deepEqual(client.submitted, []);
  assert.match(out, /0 reviewed/);
});

test("stdin ending mid-item stops cleanly instead of hanging", async () => {
  const client = fakeClient(VOCAB);

  const out = await runReview(client, ["reassuring"]); // no reading answer follows

  assert.deepEqual(client.submitted, []);
  assert.match(out, /0 reviewed, 0 perfect/);
});

test("an empty queue says so and asks for nothing", async () => {
  const client = fakeClient(VOCAB);
  client.getAssignments = async () => [];

  const out = await runReview(client, []);

  assert.match(out, /No reviews due right now/);
});
