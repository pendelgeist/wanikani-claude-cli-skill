import { test } from "node:test";
import assert from "node:assert/strict";
import { promptFor, correctionsFor, readingNudgeFor, explainBlock, batchSummaryLine } from "../lib/present.js";

const KANJI = {
  characters: "親",
  subjectType: "kanji",
  documentUrl: "https://www.wanikani.com/kanji/親",
  meanings: [{ meaning: "Parent", primary: true, accepted_answer: true }],
  readings: [
    { type: "onyomi", primary: true, accepted_answer: true, reading: "しん" },
    { type: "kunyomi", primary: false, accepted_answer: false, reading: "おや" },
  ],
};

const VOCAB = {
  characters: "心強い",
  subjectType: "vocabulary",
  documentUrl: "https://www.wanikani.com/vocabulary/心強い",
  meanings: [
    { meaning: "Reassuring", primary: true, accepted_answer: true },
    { meaning: "Heartening", primary: false, accepted_answer: true },
    { meaning: "Encouraged", primary: false, accepted_answer: false },
  ],
  readings: [
    { reading: "こころづよい", primary: true, accepted_answer: true },
    { reading: "こころずよい", primary: false, accepted_answer: false },
  ],
};

const RADICAL = {
  characters: null,
  subjectType: "radical",
  // Real character-image URLs are opaque file hashes — no slug, nothing to leak.
  characterImageUrl: "https://files.wanikani.com/x9pgnj8ehc46t60vzn6ovqow0zvz.png",
  documentUrl: "https://www.wanikani.com/radicals/hook",
  meanings: [{ meaning: "Hook", primary: true, accepted_answer: true }],
};

test("promptFor is the number and the characters, nothing else", () => {
  assert.equal(promptFor(VOCAB, 3), "3. 心強い");
  assert.equal(promptFor(VOCAB, null), "心強い");
});

test("promptFor never carries the meaning that is being asked for", () => {
  const prompt = promptFor(VOCAB, 1);
  assert.doesNotMatch(prompt, /[A-Za-z(]/, "a Latin letter or bracket here would be the answer");
});

test("promptFor shows a glyph-less radical as a bare image URL, never a description", () => {
  // Markdown image syntax doesn't render in a terminal, and an un-rendered
  // one invites naming the radical instead — "Rib Cage image" is the answer.
  assert.equal(promptFor(RADICAL, 2), "2. https://files.wanikani.com/x9pgnj8ehc46t60vzn6ovqow0zvz.png");
  assert.doesNotMatch(promptFor(RADICAL, 2), /Hook/i);
  assert.doesNotMatch(promptFor(RADICAL, 2), /wanikani\.com\/radicals/, "the document URL slug is the name");
});

test("promptFor gives up rather than inventing a prompt with no glyph or image", () => {
  assert.equal(promptFor({ characters: null, characterImageUrl: null }, 1), null);
});

test("correctionsFor reveals kana verbatim, never romaji", () => {
  const { reading } = correctionsFor(VOCAB);
  assert.equal(reading, "reading is こころづよい · https://jisho.org/word/心強い");

  // The label and the link are English; the answer must not be.
  const answer = reading.replace(/^reading is /, "").replace(/ · https:\/\/\S+$/, "");
  assert.doesNotMatch(answer, /[A-Za-z]/, "romaji in a correction is the bug this exists to prevent");
});

test("correctionsFor lists every accepted answer and no rejected one", () => {
  const { meaning, reading } = correctionsFor(VOCAB);
  assert.match(meaning, /^meaning is Reassuring \/ Heartening ·/);
  assert.doesNotMatch(reading, /こころずよい/);
});

test("every correction line carries the lookup link, since a separate field never got printed", () => {
  for (const line of Object.values(correctionsFor(VOCAB))) {
    assert.match(line, / · https:\/\/jisho\.org\/word\/心強い$/);
  }
});

test("correctionsFor combines both misses into one line rather than two", () => {
  assert.equal(
    correctionsFor(VOCAB).both,
    "meaning is Reassuring / Heartening · reading is こころづよい · https://jisho.org/word/心強い",
  );
});

test("correctionsFor sends a kanji to Jisho's kanji page, not the word of the same name", () => {
  // jisho.org/word/親 is おや — the reading the correction just ruled out.
  assert.match(correctionsFor(KANJI).reading, /jisho\.org\/search\/親%20%23kanji$/);
});

test("correctionsFor links WaniKani for radicals, which Jisho doesn't have", () => {
  assert.equal(correctionsFor(RADICAL).meaning, "meaning is Hook · https://www.wanikani.com/radicals/hook");
  assert.equal(
    correctionsFor({ ...RADICAL, subjectType: "radical", characters: "亅" }).meaning,
    "meaning is Hook · https://www.wanikani.com/radicals/hook",
    "a radical with a glyph is still not a word",
  );
});

test("correctionsFor has no reading or both line for a meaning-only item", () => {
  assert.equal(correctionsFor(RADICAL).reading, null);
  assert.equal(correctionsFor(RADICAL).both, null);
});

test("correctionsFor names the reading type for a kanji, so the reveal answers 'which one?'", () => {
  assert.match(correctionsFor(KANJI).reading, /^reading is しん \(on'yomi\) ·/);
  assert.doesNotMatch(correctionsFor(KANJI).reading, /おや/, "only accepted readings are revealed");
});

test("correctionsFor leaves a typeless (vocabulary) reading unannotated", () => {
  assert.match(correctionsFor(VOCAB).reading, /^reading is こころづよい ·/);
});

test("explainBlock doesn't pass a rejected vocabulary spelling off as another reading", () => {
  // こころずよい is a misspelling WaniKani lists to reject; "also read" it isn't.
  const block = explainBlock({ ...VOCAB, level: 3 });

  assert.match(block, /^Reading: こころづよい$/m);
  assert.doesNotMatch(block, /こころずよい/);
});

test("readingNudgeFor names the type wanted and reveals no kana", () => {
  const nudge = readingNudgeFor("onyomi");
  assert.match(nudge, /on'yomi/);
  assert.doesNotMatch(nudge, /[ぁ-ゟ゠-ヿ]/, "a re-prompt that shows the reading isn't a re-prompt");
});

test("readingNudgeFor still says something useful with no type to name", () => {
  const nudge = readingNudgeFor(null);
  assert.match(nudge, /try again/);
  assert.doesNotMatch(nudge, /undefined|null/);
});

test("batchSummaryLine names what changed status", () => {
  const line = batchSummaryLine({
    submitted: 10,
    perfect: 8,
    highlights: [
      { characters: "心強い", tierChange: "promoted", endingSrsStage: 5 },
      { characters: "集中", tierChange: "burned", endingSrsStage: 9 },
      { characters: "作業", tierChange: "demoted", endingSrsStage: 1 },
    ],
    remaining: 127,
  });

  assert.equal(line, "10 done, 8 perfect · 心強い → Guru, 集中 → Burned, 作業 slipped to Apprentice 1 · 127 left");
});

test("batchSummaryLine drops segments that would say nothing", () => {
  assert.equal(batchSummaryLine({ submitted: 10, perfect: 10 }), "10 done, 10 perfect");
  assert.equal(
    batchSummaryLine({ submitted: 3, perfect: 3, remaining: 0 }),
    "3 done, 3 perfect",
    "nothing left is not worth a segment",
  );
});

test("batchSummaryLine switches to counts once naming becomes a list", () => {
  const highlights = [
    { characters: "一", tierChange: "promoted", endingSrsStage: 5 },
    { characters: "二", tierChange: "promoted", endingSrsStage: 5 },
    { characters: "三", tierChange: "promoted", endingSrsStage: 5 },
    { characters: "四", tierChange: "burned", endingSrsStage: 9 },
    { characters: "五", tierChange: "demoted", endingSrsStage: 2 },
  ];

  assert.match(batchSummaryLine({ submitted: 10, perfect: 5, highlights }), /3 moved up, 1 burned, 1 slipped back/);
});

test("batchSummaryLine falls back to counts when a name could not be resolved", () => {
  const line = batchSummaryLine({
    submitted: 2,
    perfect: 2,
    highlights: [
      { characters: null, tierChange: "promoted", endingSrsStage: 5 },
      { characters: "集中", tierChange: "burned", endingSrsStage: 9 },
    ],
  });

  assert.match(line, /1 moved up, 1 burned/);
  assert.doesNotMatch(line, /null/);
});

test("batchSummaryLine adds the session total only once it exceeds the batch", () => {
  const first = batchSummaryLine({ submitted: 10, perfect: 9, sessionSubmitted: 10, sessionPerfect: 9 });
  assert.doesNotMatch(first, /this session/, "on batch one the session total is the batch total");

  const later = batchSummaryLine({ submitted: 10, perfect: 8, sessionSubmitted: 30, sessionPerfect: 25 });
  assert.match(later, /30 done this sitting, 25 perfect/);
});

test("batchSummaryLine surfaces submit failures", () => {
  assert.match(
    batchSummaryLine({ submitted: 9, perfect: 9, failures: { retryable: 1 } }),
    /1 failed to submit/,
  );
});

test("the summary line says what becomes of anything that failed to submit", () => {
  const line = batchSummaryLine({
    submitted: 8,
    perfect: 8,
    failures: { retryable: 1, dropped: 1 },
    remaining: 12,
  });

  const [stats, fate] = line.split("\n");
  assert.match(stats, /2 failed to submit/);
  assert.match(fate, /^1 stays in the queue for a later batch; 1 was rejected outright/);
  assert.match(fate, /already reviewed somewhere else\.$/);
});

test("a clean batch gets no second line at all", () => {
  assert.doesNotMatch(batchSummaryLine({ submitted: 10, perfect: 10 }), /\n/);
});
