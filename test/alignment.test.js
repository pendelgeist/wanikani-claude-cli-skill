import { test } from "node:test";
import assert from "node:assert/strict";
import { findMisalignment, scoreAnswer } from "../lib/alignment.js";

/**
 * The batch that made this necessary, as it actually went in: ten items, nine
 * answers, and the radical at position four left out rather than blanked. See
 * lib/alignment.js.
 */
const vocab = (id, characters, meaning, reading) => ({
  id,
  object: "vocabulary",
  data: {
    level: 12,
    characters,
    document_url: `https://www.wanikani.com/vocabulary/${characters}`,
    meanings: meaning.map((entry, index) => ({ meaning: entry, primary: index === 0, accepted_answer: true })),
    auxiliary_meanings: [],
    readings: [{ primary: true, accepted_answer: true, reading }],
  },
});

const kanji = (id, characters, meaning, reading) => ({
  id,
  object: "kanji",
  data: {
    level: 12,
    characters,
    document_url: `https://www.wanikani.com/kanji/${characters}`,
    meanings: [{ meaning, primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [{ type: "onyomi", primary: true, accepted_answer: true, reading }],
  },
});

const radical = (id, characters, meaning) => ({
  id,
  object: "radical",
  data: {
    level: 12,
    characters,
    document_url: `https://www.wanikani.com/radicals/${meaning.toLowerCase()}`,
    meanings: [{ meaning, primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
  },
});

const BATCH = [
  kanji(1, "待", "Wait", "たい"),
  vocab(2, "気付く", ["To Realize"], "きづく"),
  vocab(3, "持つ", ["To Hold"], "もつ"),
  radical(4, "𠫓", "Trash"),
  vocab(5, "中古", ["Secondhand", "Used"], "ちゅうこ"),
  radical(6, "単", "Simple"),
  vocab(7, "欠く", ["To Lack Something", "To Be Without"], "かく"),
  vocab(8, "成る", ["To Become"], "なる"),
  vocab(9, "決定", ["Decision", "Determination"], "けってい"),
  kanji(10, "成", "Become", "せい"),
];

const AS_TYPED = [
  "wait tai",
  "to realize kidzuku",
  "to hold tamotsu",
  "used chuuko",
  "sipmle",
  "to lack something kaku",
  "to become naru",
  "decision dettei",
  "become sei",
];

test("an item skipped in the middle is caught before anything is recorded", async () => {
  const skew = findMisalignment(AS_TYPED, BATCH);

  assert.ok(skew, "nine answers that answer items 1-3 and 5-10 is not a list that stopped short");
  // Answer 4 ("used chuuko") is 中古, which is item 5 — the radical at 4 was
  // passed over. Zero-indexed here; the message adds one.
  assert.equal(skew.answerIndex, 3);
  assert.equal(skew.fitsIndex, 4);
});

test("the shifted reading is the one that fits, by a wide margin", () => {
  const straight = AS_TYPED.reduce((total, reply, index) => total + scoreAnswer(reply, BATCH[index]), 0);
  const shifted = AS_TYPED.reduce(
    (total, reply, index) => total + scoreAnswer(reply, BATCH[index < 3 ? index : index + 1]),
    0,
  );

  // Not a close call: five items the user plainly knew went down as misses,
  // and two of them were demoted a level for it.
  assert.ok(shifted > straight + 4, `straight ${straight}, shifted ${shifted}`);
});

test("a list that simply stops short is graded as typed", () => {
  // The documented thing to do — "answer as few as you like; the rest keep".
  // The first three answers belong to the first three items and nothing about
  // them fits any item better, so there is nothing to refuse.
  assert.equal(findMisalignment(AS_TYPED.slice(0, 3), BATCH), null);
});

test("wrong answers are not a misalignment", () => {
  // Every one of these is wrong about its own item and wrong about every
  // other item in the batch. Being wrong is not evidence of a skew, and
  // refusing to grade it would be refusing to record a real miss.
  const wrong = ["x x", "x x", "x x", "x x", "x x", "x x"];
  assert.equal(findMisalignment(wrong, BATCH), null);
});

test("a full-length reply has nothing to shift", () => {
  const everything = [...AS_TYPED, "become sei"];
  assert.equal(everything.length, BATCH.length);
  assert.equal(findMisalignment(everything, BATCH), null);
});

test("an answer that lands on a later item by coincidence isn't enough", () => {
  // One point of improvement is a near-miss somewhere else in the batch, not
  // a skipped item: grade it as typed. The margin is a whole item.
  const [first] = BATCH;
  const nearly = ["wait tai", "wait"];
  const skew = findMisalignment(nearly, [first, ...BATCH.slice(1)]);
  assert.equal(skew, null);
});
