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

test("promptFor is the number, the characters and the kind of thing being asked", () => {
  assert.equal(promptFor(VOCAB, 3), "3. 心強い (vocabulary)");
  assert.equal(promptFor(VOCAB, null), "心強い (vocabulary)");
});

test("the same glyph asked as two different subjects reads as two different questions", () => {
  // 末 came up twice in one sitting — the vocabulary word (すえ) and the kanji
  // (まつ) — and both prompts read `末` and nothing else. The user gave each
  // one the other's reading and lost both. The type is the half of the
  // question that was missing, and it is what WaniKani's own review screen
  // colours the banner for.
  const asVocab = { ...VOCAB, characters: "末" };
  const asKanji = { ...KANJI, characters: "末" };
  assert.notEqual(promptFor(asVocab, 3), promptFor(asKanji, 9).replace(/^9/, "3"));
  assert.match(promptFor(asKanji, 9), /kanji/);
  assert.match(promptFor(asVocab, 3), /vocabulary/);
});

test("promptFor asks no question of its own, on any item type", () => {
  // The tail lived here for one release. A prompt that arrived as a finished
  // question got answered by the session that was supposed to be asking it —
  // four items in five — so the prompt is a fragment again, and there is
  // nothing here for a reader to mistake for a question addressed to them. A
  // type label is not a question: no verb, no "?", and nothing asked for.
  for (const item of [VOCAB, KANJI, RADICAL_WITH_GLYPH, { ...VOCAB, subjectType: "kana_vocabulary" }]) {
    assert.doesNotMatch(promptFor(item, 1), /meaning|reading|\?/i);
  }
});

test("promptFor never carries the meaning that is being asked for", () => {
  for (const item of [VOCAB, KANJI, RADICAL_WITH_GLYPH]) {
    const prompt = promptFor(item, 1);
    for (const { meaning } of item.meanings) {
      assert.doesNotMatch(prompt, new RegExp(meaning, "i"), `${meaning} in the prompt is the answer`);
    }
    for (const { reading } of item.readings ?? []) {
      assert.ok(!prompt.includes(reading), `${reading} in the prompt is the answer`);
    }
    // The only Latin in any of them is the type.
    assert.doesNotMatch(prompt.replace(/ \([a-z ]+\)$/, ""), /[A-Za-z]/);
  }
});

test("promptFor shows a glyph-less radical as an image URL and a type, never a description", () => {
  // Markdown image syntax doesn't render in a terminal, and an un-rendered
  // one invites naming the radical instead — "Rib Cage image" is the answer.
  // "(radical)" names the kind, which is what the picture already is.
  assert.equal(
    promptFor(RADICAL, 2),
    "2. https://files.wanikani.com/x9pgnj8ehc46t60vzn6ovqow0zvz.png (radical)",
  );
  assert.doesNotMatch(promptFor(RADICAL, 2), /Hook/i);
  assert.doesNotMatch(promptFor(RADICAL, 2), /!\[/);
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

test("a correction names each reading type once, not once per reading", () => {
  // 軽 accepts かる and かろ, both kun'yomi, and the line read "reading is かる
  // (kun'yomi) / かろ (kun'yomi)".
  const light = {
    characters: "軽",
    subjectType: "kanji",
    documentUrl: "https://www.wanikani.com/kanji/軽",
    meanings: [{ meaning: "Lightweight", primary: true, accepted_answer: true }],
    readings: [
      { type: "kunyomi", primary: true, accepted_answer: true, reading: "かる" },
      { type: "kunyomi", primary: false, accepted_answer: true, reading: "かろ" },
      { type: "onyomi", primary: false, accepted_answer: false, reading: "けい" },
    ],
  };

  assert.match(correctionsFor(light).reading, /^reading is かる \/ かろ \(kun'yomi\) · /);

  // Two types is still two labels — the grouping is per type, not a trim.
  const tries = { ...light, characters: "試", readings: [
    { type: "onyomi", primary: true, accepted_answer: true, reading: "し" },
    { type: "kunyomi", primary: false, accepted_answer: true, reading: "ため" },
  ] };
  assert.match(correctionsFor(tries).reading, /^reading is し \(on'yomi\), ため \(kun'yomi\) · /);

  // A vocabulary word's readings carry no type and stay bare kana.
  assert.match(correctionsFor(VOCAB).reading, /^reading is こころづよい · /);
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
});

test("batchSummaryLine says so when the queue is empty", () => {
  assert.equal(
    batchSummaryLine({ submitted: 3, perfect: 3, remaining: 0 }),
    "3 done, 3 perfect · none left",
    "an emptied queue is the count most worth stating",
  );
  assert.equal(
    batchSummaryLine({ submitted: 3, perfect: 3, remaining: null }),
    "3 done, 3 perfect",
    "an unknown remainder still says nothing, rather than guessing at zero",
  );
});

test("batchSummaryLine explains a remainder that went up rather than down", () => {
  assert.equal(
    batchSummaryLine({ submitted: 7, perfect: 6, remaining: 31, remainingNewlyDue: true }),
    "7 done, 6 perfect · 31 left — all of them come due since the last fetch",
    "a number moving the wrong way with nothing said is how a working tool gets called broken",
  );
  assert.equal(
    batchSummaryLine({ submitted: 7, perfect: 6, remaining: 31 }),
    "7 done, 6 perfect · 31 left",
    "the clause only rides a count that actually needs it",
  );
  assert.equal(
    batchSummaryLine({ submitted: 7, perfect: 7, remaining: 0, remainingNewlyDue: true }),
    "7 done, 7 perfect · none left",
    "nothing left is nothing to explain",
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
  assert.match(later, /30 done this sitting, 25 perfect \(83%\)/);
});

test("the sitting's score carries the percentage, so nobody has to work it out", () => {
  // Three sittings running closed on a percentage composed in prose from the
  // two numbers already on the line. The arithmetic was right each time; the
  // same arithmetic on an earlier sitting produced "60 reviewed, 46 perfect"
  // against a real 70 and 53.
  assert.match(
    batchSummaryLine({ submitted: 7, perfect: 5, sessionSubmitted: 94, sessionPerfect: 68 }),
    /94 done this sitting, 68 perfect \(72%\)/,
  );
  // The batch's own share stays off — a percentage of ten is noise, and it is
  // not the figure that kept being derived.
  assert.doesNotMatch(batchSummaryLine({ submitted: 10, perfect: 8, remaining: 4 }), /%/);
  // Nothing to divide by, and nothing known to divide.
  assert.match(
    batchSummaryLine({ submitted: 3, perfect: 3, sessionSubmitted: 10, sessionPerfect: null }),
    /10 done this sitting ·|10 done this sitting$/,
  );
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

test("a stacked batch is prompts and the how-to line, and no questions of its own", () => {
  const block = promptListFor([
    { ...KANJI, position: 1 },
    { ...RADICAL_WITH_GLYPH, position: 2 },
  ]);

  assert.match(
    block,
    /^1\. 親 \(kanji\)$/m,
    "ten copies of the tail down the left is the noise it was left off to avoid",
  );
  assert.match(block, /^2\. 亅 \(radical\)$/m);
  assert.match(block, /meaning and reading together on each/, "the convention line asks for all of them at once");
});
