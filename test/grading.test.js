import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requiresReading,
  splitAnswer,
  isMeaningCorrect,
  isReadingCorrect,
  readingCandidates,
  readingVerdict,
  wantedReadingType,
  unacceptedReadings,
  normalizeReadingInput,
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

const official = {
  characters: "役人",
  meanings: [
    { meaning: "Public Official", primary: true, accepted_answer: true },
    { meaning: "Government Official", primary: false, accepted_answer: true },
  ],
  auxiliary_meanings: [{ meaning: "Government Office", type: "blacklist" }],
};

test("isMeaningCorrect forgives a typo, the way the website forgives one", () => {
  // The session that made this necessary marked "government offical" wrong,
  // then printed the meaning in the correction, then asked the same item
  // again — so the user typed back the word the correction had just shown
  // them, and got a ✓ over a miss that was already recorded.
  assert.equal(isMeaningCorrect("government offical", official), true);
  assert.equal(isMeaningCorrect("goverment official", official), true);
  assert.equal(isMeaningCorrect("public offical", official), true);
});

test("two letters swapped is one typo, not two", () => {
  assert.equal(isMeaningCorrect("pubilc official", official), true);
});

test("a short meaning gets no slack, since one letter makes it another word", () => {
  assert.equal(isMeaningCorrect("won", kanjiOne), false);
  assert.equal(isMeaningCorrect("ones", kanjiOne), false);
});

test("a near miss can't reach past a meaning the item refuses", () => {
  // "Government Office" is blacklisted and one edit away from what was typed;
  // "Government Official" is three. The nearer one decides it.
  assert.equal(isMeaningCorrect("government offce", official), false);
  assert.equal(isMeaningCorrect("government office", official), false);
});

test("a real word that isn't the meaning stays wrong, however close it looks", () => {
  assert.equal(isMeaningCorrect("public officer", official), false);
  assert.equal(isMeaningCorrect("government officials office", official), false);
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

test("normalizeReadingInput accepts the dzu/dji IME spellings of づ/ぢ", () => {
  // wanakana only understands "du"/"di" here — "dzu" alone comes back as "dず".
  assert.equal(normalizeReadingInput("kokorodzuyoi"), "こころづよい");
  assert.equal(normalizeReadingInput("kokoroduyoi"), "こころづよい");
  assert.equal(normalizeReadingInput("hanadji"), "はなぢ");
});

test("normalizeReadingInput leaves plain zu/ji alone", () => {
  assert.equal(normalizeReadingInput("kokorozuyoi"), "こころずよい");
  assert.equal(normalizeReadingInput("kaji"), "かじ");
});

test("isReadingCorrect accepts either IME spelling of づ", () => {
  const kokorozuyoi = {
    characters: "心強い",
    meanings: [{ meaning: "Reassuring", primary: true, accepted_answer: true }],
    readings: [{ primary: true, accepted_answer: true, reading: "こころづよい" }],
  };
  assert.equal(isReadingCorrect("こころづよい", kokorozuyoi), true);
  assert.equal(isReadingCorrect("kokoroduyoi", kokorozuyoi), true);
  assert.equal(isReadingCorrect("kokorodzuyoi", kokorozuyoi), true);
});

test("isReadingCorrect rejects non-accepted (but real) readings", () => {
  // Not the accepted answer — though it isn't scored as a miss either; that
  // distinction belongs to readingVerdict, below.
  assert.equal(isReadingCorrect("ひと", kanjiOne), false); // kunyomi, accepted_answer: false
});

// 親: WaniKani wants the on'yomi, but おや and した are both real readings of it
// and typing either one is the mistake this whole verdict exists for.
const kanjiParent = {
  characters: "親",
  meanings: [{ meaning: "Parent", primary: true, accepted_answer: true }],
  auxiliary_meanings: [],
  readings: [
    { type: "onyomi", primary: true, accepted_answer: true, reading: "しん" },
    { type: "kunyomi", primary: false, accepted_answer: false, reading: "おや" },
    { type: "kunyomi", primary: false, accepted_answer: false, reading: "した" },
  ],
};

const vocabKokorozuyoi = {
  characters: "心強い",
  meanings: [{ meaning: "Reassuring", primary: true, accepted_answer: true }],
  readings: [
    { primary: true, accepted_answer: true, reading: "こころづよい" },
    { primary: false, accepted_answer: false, reading: "こころずよい" },
  ],
};

test("wantedReadingType names the type a kanji is asking for", () => {
  assert.equal(wantedReadingType(kanjiParent), "onyomi");
  assert.equal(wantedReadingType(kanjiOne), "onyomi");
});

test("wantedReadingType has nothing to name for vocabulary or a radical", () => {
  assert.equal(wantedReadingType(vocabKokorozuyoi), null);
  assert.equal(wantedReadingType(groundRadical), null);
});

test("wantedReadingType stays quiet when accepted readings span two types", () => {
  const both = {
    readings: [
      { type: "onyomi", accepted_answer: true, reading: "こう" },
      { type: "kunyomi", accepted_answer: true, reading: "い" },
    ],
  };
  assert.equal(wantedReadingType(both), null);
});

test("readingVerdict grades an accepted reading correct, in kana or romaji", () => {
  assert.equal(readingVerdict("しん", kanjiParent).status, "correct");
  assert.equal(readingVerdict("shin", kanjiParent).status, "correct");
});

test("readingVerdict treats another real reading of the kanji as a re-prompt, not a miss", () => {
  // The website shakes and asks again here; marking it wrong would cost SRS
  // progress WaniKani itself wouldn't have taken.
  for (const answer of ["おや", "oya", "した", "shita"]) {
    const verdict = readingVerdict(answer, kanjiParent);
    assert.equal(verdict.status, "other-reading", `${answer} is a real reading of 親`);
    assert.equal(verdict.wantedType, "onyomi");
    assert.equal(verdict.gaveType, "kunyomi");
  }
});

test("readingVerdict keeps a reading the kanji simply doesn't have as a miss", () => {
  assert.equal(readingVerdict("ねこ", kanjiParent).status, "incorrect");
  assert.equal(readingVerdict("", kanjiParent).status, "incorrect");
});

test("readingVerdict gives a vocabulary near-miss no such reprieve", () => {
  // こころずよい is a misspelling WaniKani lists and rejects — not another way
  // to read the word — so ず for づ stays wrong, as it is on the website.
  assert.equal(readingVerdict("こころずよい", vocabKokorozuyoi).status, "incorrect");
  assert.equal(readingVerdict("kokorozuyoi", vocabKokorozuyoi).status, "incorrect");
  assert.deepEqual(unacceptedReadings(vocabKokorozuyoi), []);
});

// 親友 — the case that started this: しんゆう typed "shinyuu", which every
// romaji converter reads as し・にゅう unless an apostrophe stops it.
const closeFriend = {
  characters: "親友",
  meanings: [{ meaning: "Best Friend", primary: true, accepted_answer: true }],
  readings: [{ primary: true, accepted_answer: true, reading: "しんゆう" }],
};

test("an n before a vowel or y is read both ways, since romaji can't tell them apart", () => {
  for (const spelling of ["shinyuu", "shin'yuu", "しんゆう"]) {
    assert.equal(isReadingCorrect(spelling, closeFriend), true, spelling);
  }

  const friday = { readings: [{ accepted_answer: true, reading: "きんようび" }] };
  assert.equal(isReadingCorrect("kinyoubi", friday), true);

  const everyone = { readings: [{ accepted_answer: true, reading: "ぜんいん" }] };
  assert.equal(isReadingCorrect("zenin", everyone), true);
});

test("reading both ways can't turn a wrong answer into a right one", () => {
  // The alternate parse only ever matches when it *is* an accepted reading.
  assert.equal(isReadingCorrect("shinyuu", kanjiOne), false);
  assert.equal(isReadingCorrect("hana", closeFriend), false);
  assert.deepEqual(readingCandidates("hana"), ["はな", "はんあ"]);
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

test("a long vowel typed twice is the same reading, not a different one", () => {
  // ページ: "peeji" to most people, "pe-ji" to a converter. The user typed the
  // hyphen and had it stripped on the way in, then spelled it out and was
  // marked wrong twice for a word they knew.
  const page = {
    readings: [
      { accepted_answer: true, reading: "ページ" },
      { accepted_answer: true, reading: "ぺーじ" },
    ],
  };

  for (const typed of ["pe-ji", "peeji", "ページ", "ぺーじ"]) {
    assert.equal(isReadingCorrect(typed, page), true, typed);
  }
  assert.equal(isReadingCorrect("peji", page), false, "a short vowel is still a different word");
});

test("a meaning-only item takes a volunteered reading off an otherwise correct answer", () => {
  // 令 was asked for its meaning alone and answered "orders. rei", because
  // "meaning, reading" is the habit of the sitting and it doesn't switch off
  // for one item in ten. Grading the whole line as the meaning made a right
  // answer a miss.
  const radical = {
    characters: "令",
    meanings: [{ meaning: "Orders", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [],
  };

  for (const typed of ["orders. rei", "orders, rei", ".orders. rei", "orders / rei"]) {
    const split = splitAnswer(typed, radical, false);
    assert.equal(split.reading, null, "a meaning-only item still grades no reading");
    assert.equal(isMeaningCorrect(split.meaning, radical), true, typed);
  }

  assert.equal(splitAnswer("orders", radical, false).meaning, "orders", "an answer with no tail is untouched");
});

test("a meaning-only item's wrong answer stays wrong, however much follows it", () => {
  const radical = {
    characters: "令",
    meanings: [{ meaning: "Orders", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [],
  };

  // Shedding the tail is for a volunteered reading, not for a spray of
  // guesses: the leading answer has to be the right one on its own.
  for (const typed of ["chase, orders", "rei. orders", "chase", "orders, rei, extra"]) {
    const { meaning } = splitAnswer(typed, radical, false);
    assert.equal(isMeaningCorrect(meaning, radical), false, typed);
  }
});
