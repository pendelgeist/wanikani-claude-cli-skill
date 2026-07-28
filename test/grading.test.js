import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requiresReading,
  isMeaningCorrect,
  isReadingCorrect,
  primaryMeaning,
  primaryReading,
  stripMnemonicMarkup,
} from "../lib/grading.js";

const kanjiOne = {
  characters: "一",
  meanings: [{ meaning: "One", primary: true, accepted_answer: true }],
  auxiliary_meanings: [
    { meaning: "won", type: "blacklist" }, // homophone that looks plausible but is wrong
    { meaning: "single", type: "whitelist" },
  ],
  readings: [
    { type: "onyomi", primary: true, accepted_answer: true, reading: "いち" },
    { type: "kunyomi", primary: false, accepted_answer: false, reading: "ひと" },
  ],
};

const groundRadical = {
  characters: null,
  meanings: [{ meaning: "Ground", primary: true, accepted_answer: true }],
  auxiliary_meanings: [],
};

test("requiresReading distinguishes meaning-only subject types", () => {
  assert.equal(requiresReading("radical"), false);
  assert.equal(requiresReading("kana_vocabulary"), false);
  assert.equal(requiresReading("kanji"), true);
  assert.equal(requiresReading("vocabulary"), true);
});

test("isMeaningCorrect accepts the primary meaning, case/whitespace-insensitive", () => {
  assert.equal(isMeaningCorrect("One", kanjiOne), true);
  assert.equal(isMeaningCorrect("  ONE  ", kanjiOne), true);
});

test("isMeaningCorrect accepts whitelisted auxiliary meanings", () => {
  assert.equal(isMeaningCorrect("single", kanjiOne), true);
});

test("isMeaningCorrect rejects blacklisted auxiliary meanings even though they look plausible", () => {
  assert.equal(isMeaningCorrect("won", kanjiOne), false);
});

test("isMeaningCorrect rejects unrelated input", () => {
  assert.equal(isMeaningCorrect("two", kanjiOne), false);
  assert.equal(isMeaningCorrect("", kanjiOne), false);
});

test("isReadingCorrect matches accepted kana readings", () => {
  assert.equal(isReadingCorrect("いち", kanjiOne), true);
});

test("isReadingCorrect converts romaji input to kana before matching", () => {
  assert.equal(isReadingCorrect("ichi", kanjiOne), true);
});

test("isReadingCorrect rejects non-accepted (but real) readings", () => {
  assert.equal(isReadingCorrect("ひと", kanjiOne), false); // kunyomi, accepted_answer: false
});

test("primaryMeaning and primaryReading pick the primary entry", () => {
  assert.equal(primaryMeaning(kanjiOne), "One");
  assert.equal(primaryReading(kanjiOne), "いち");
});

test("primaryMeaning works for subjects without readings (radicals)", () => {
  assert.equal(primaryMeaning(groundRadical), "Ground");
  assert.equal(primaryReading(groundRadical), undefined);
});

test("stripMnemonicMarkup removes WaniKani's markup tags", () => {
  assert.equal(
    stripMnemonicMarkup("Lying on the <radical>ground</radical> is the <kanji>One</kanji>."),
    "Lying on the ground is the One.",
  );
});

test("stripMnemonicMarkup passes through null/empty", () => {
  assert.equal(stripMnemonicMarkup(null), null);
  assert.equal(stripMnemonicMarkup(""), "");
});
