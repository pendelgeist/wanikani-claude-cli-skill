import { test } from "node:test";
import assert from "node:assert/strict";
import {
  promptFor,
  promptListFor,
  correctionsFor,
  readingNudgeFor,
  explainBlock,
  batchSummaryLine,
} from "../lib/present.js";

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

const RADICAL_WITH_GLYPH = { ...RADICAL, characters: "亅", characterImageUrl: null };

test("promptFor is the number, the characters, and the question — nothing else", () => {
  assert.equal(promptFor(VOCAB, 3), "3. 心強い — meaning & reading?");
  assert.equal(promptFor(VOCAB, null), "心強い — meaning & reading?");
});

test("promptFor asks a meaning-only item for the meaning alone", () => {
  assert.equal(promptFor(RADICAL_WITH_GLYPH, 4), "4. 亅 — meaning?");
  assert.equal(promptFor({ ...VOCAB, subjectType: "kana_vocabulary" }, 4), "4. 心強い — meaning?");
});

test("promptFor takes the item's own word for it over the type, where it has one", () => {
  // `queue` items carry `needsReading`; a bare subject view doesn't, and the
  // type answers it. Neither shape gets the wrong question.
  assert.match(promptFor({ characters: "亅", needsReading: true }, 1), / — meaning & reading\?$/);
  assert.match(promptFor({ characters: "亅", subjectType: "radical" }, 1), / — meaning\?$/);
});

test("promptFor never carries the meaning that is being asked for", () => {
  // The tail is the one piece of English allowed here, and it is the same
  // string every time — so take it off and nothing Latin may remain.
  const prompt = promptFor(VOCAB, 1).replace(/ — meaning( & reading)?\?$/, "");
  assert.doesNotMatch(prompt, /[A-Za-z(]/, "a Latin letter or bracket here would be the answer");
});

test("promptFor shows a glyph-less radical as a bare image URL, never a description", () => {
  // Markdown image syntax doesn't render in a terminal, and an un-rendered
  // one invites naming the radical instead — "Rib Cage image" is the answer.
  assert.equal(
    promptFor(RADICAL, 2),
    "2. https://files.wanikani.com/x9pgnj8ehc46t60vzn6ovqow0zvz.png — meaning?",
    "the tail sits after the URL, where the space that ends it keeps it clickable",
  );
  assert.doesNotMatch(promptFor(RADICAL, 2), /Hook/i);
  assert.doesNotMatch(promptFor(RADICAL, 2), /wanikani\.com\/radicals/, "the document URL slug is the name");
});

test("promptFor gives up rather than inventing a prompt with no glyph or image", () => {
  assert.equal(promptFor({ characters: null, characterImageUrl: null }, 1), null);
});

test("correctionsFor reveals kana verbatim, never romaji", () => {
  const { reading } = correctionsFor(VOCAB);
  assert.equal(reading, "reading is こころづよい · https://jisho.org/word/%E5%BF%83%E5%BC%B7%E3%81%84");

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
    assert.match(line, / · https:\/\/jisho\.org\/word\/%E5%BF%83%E5%BC%B7%E3%81%84$/);
  }
});

test("correctionsFor combines both misses into one line rather than two", () => {
  assert.equal(
    correctionsFor(VOCAB).both,
    "meaning is Reassuring / Heartening · reading is こころづよい · https://jisho.org/word/%E5%BF%83%E5%BC%B7%E3%81%84",
  );
});

test("correctionsFor sends a kanji to Jisho's kanji page, not the word of the same name", () => {
  // jisho.org/word/親 is おや — the reading the correction just ruled out.
  assert.match(correctionsFor(KANJI).reading, /jisho\.org\/search\/%E8%A6%AA%20%23kanji$/);
});

test("every lookup link is ASCII, so a terminal makes the whole of it clickable", () => {
  // A raw glyph in the URL breaks the link where it stands: ctrl-click opens
  // `https://jisho.org/search/` and the rest has to be pasted in by hand.
  for (const item of [KANJI, VOCAB]) {
    for (const line of Object.values(correctionsFor(item)).filter(Boolean)) {
      const link = line.match(/https:\/\/\S+$/)[0];
      assert.doesNotMatch(link, /[^\x20-\x7E]/, `not clickable to its end: ${link}`);
    }
  }
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

test("a stacked batch asks the question once underneath, not on all ten lines", () => {
  const block = promptListFor([
    { ...KANJI, position: 1 },
    { ...RADICAL_WITH_GLYPH, position: 2 },
  ]);

  assert.match(block, /^1\. 親$/m, "ten copies of the tail down the left is the noise it was left off to avoid");
  assert.match(block, /^2\. 亅$/m);
  assert.match(block, /meaning and reading together on each/, "the convention line asks for all of them at once");
});
