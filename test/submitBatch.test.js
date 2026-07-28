import { test } from "node:test";
import assert from "node:assert/strict";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";

function captureStdout(fn) {
  const original = console.log;
  let output = "";
  console.log = (msg) => {
    output += msg;
  };
  return Promise.resolve(fn()).finally(() => {
    console.log = original;
  }).then(() => output);
}

test("submitBatchCommand submits each item and reports per-item results", async () => {
  const submitted = [];
  const client = {
    async submitReview({ assignmentId, incorrectMeaningAnswers, incorrectReadingAnswers }) {
      submitted.push({ assignmentId, incorrectMeaningAnswers, incorrectReadingAnswers });
      return { data: { ending_srs_stage: 5 } };
    },
  };

  const output = await captureStdout(() =>
    submitBatchCommand(client, [
      { assignmentId: 1, wrongMeaning: 0, wrongReading: 1 },
      { assignmentId: 2 },
    ]),
  );

  assert.deepEqual(submitted, [
    { assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 1 },
    { assignmentId: 2, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 },
  ]);

  const results = JSON.parse(output);
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].srsStageName, "Guru 1");
});

test("submitBatchCommand keeps going after a per-item failure", async () => {
  const client = {
    async submitReview({ assignmentId }) {
      if (assignmentId === 2) throw new Error("404 Not Found");
      return { data: { ending_srs_stage: 1 } };
    },
  };

  const output = await captureStdout(() =>
    submitBatchCommand(client, [{ assignmentId: 1 }, { assignmentId: 2 }, { assignmentId: 3 }]),
  );

  const results = JSON.parse(output);
  assert.equal(results.length, 3);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error, "404 Not Found");
  assert.equal(results[2].ok, true);
});
