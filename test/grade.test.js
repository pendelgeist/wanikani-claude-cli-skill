import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeCommand } from "../lib/commands/grade.js";
import { splitAnswer } from "../lib/grading.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

const KANJI = {
  id: 3,
  object: "kanji",
  data: {
    level: 2,
    characters: "親",
    document_url: "https://www.wanikani.com/kanji/親",
    meanings: [{ meaning: "Parent", primary: true, accepted_answer: true }],
    auxiliary_meanings: [{ meaning: "father", type: "blacklist" }],
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
    readings: [
      { primary: true, accepted_answer: true, reading: "こころづよい" },
      { primary: false, accepted_answer: false, reading: "こころずよい" },
    ],
  },
};

const RADICAL = {
  id: 5,
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

const client = {
  async getSubjectsByIds(ids) {
    return new Map(
      ids.map((id) => [id, [KANJI, VOCAB, RADICAL].find((s) => s.id === id)]).filter(([, s]) => s),
    );
  },
};

const grade = (options) =>
  withTempCacheDir(async () =>
    JSON.parse(await captureStdout(() => gradeCommand(client, { ...options, json: true }))),
  );

test("splitAnswer finds the reading half by grading it, not by word order", () => {
  for (const reply of ["parent, shin", "shin, parent", "parent shin", "shin parent", "parent / しん"]) {
    const { meaning, reading } = splitAnswer(reply, KANJI.data, true);
    assert.equal(reading.trim().replace(/し ん/, "しん"), reply.includes("しん") ? "しん" : "shin", reply);
    assert.equal(meaning, "parent", reply);
  }
});

test("splitAnswer keeps a multi-word meaning together", () => {
  const { meaning, reading } = splitAnswer("to realize, kidzuku", VOCAB.data, true);

  assert.equal(meaning, "to realize");
  assert.equal(reading, "kidzuku");
});

test("splitAnswer treats a lone answer as the half it can recognise", () => {
  assert.deepEqual(splitAnswer("parent", KANJI.data, true), { meaning: "parent", reading: null });
  assert.deepEqual(splitAnswer("しん", KANJI.data, true), { meaning: null, reading: "しん" });
  assert.deepEqual(splitAnswer("hook", RADICAL.data, false), { meaning: "hook", reading: null });
});

test("both halves right is a clean pass with nothing to say", async () => {
  const verdict = await grade({ subjectId: 3, answer: "parent, shin" });

  assert.deepEqual(
    { meaning: verdict.meaning, reading: verdict.reading, say: verdict.say, open: verdict.open },
    { meaning: "correct", reading: "correct", say: null, open: false },
  );
  assert.equal(verdict.wrongMeaning + verdict.wrongReading, 0);
});

test("another of the kanji's readings re-prompts and costs nothing", async () => {
  const verdict = await grade({ subjectId: 3, answer: "parent, oya" });

  assert.equal(verdict.reading, "other-reading");
  assert.equal(verdict.open, true, "the item is still waiting on them");
  assert.match(verdict.say, /WaniKani wants the on'yomi/);
  assert.equal(verdict.wrongMeaning + verdict.wrongReading, 0);
});

test("a follow-up can name the half it's answering", async () => {
  const verdict = await grade({ subjectId: 3, reading: "shin" });

  assert.deepEqual([verdict.meaning, verdict.reading], [null, "correct"]);
  assert.equal(verdict.open, false);
  assert.equal(verdict.say, null);
});

test("a right meaning with no reading yet asks for it", async () => {
  const verdict = await grade({ subjectId: 3, answer: "parent" });

  assert.equal(verdict.say, "Reading?");
  assert.equal(verdict.open, true);
  assert.equal(verdict.wrongMeaning, 0);
});

test("a missed reading reveals the reading line and closes the item", async () => {
  const verdict = await grade({ subjectId: 3, answer: "parent, mi" });

  assert.equal(verdict.reading, "incorrect");
  assert.equal(verdict.wrongReading, 1);
  assert.equal(verdict.say, "reading is しん (on'yomi) · https://jisho.org/search/親%20%23kanji");
  assert.equal(verdict.open, false);
});

test("a missed meaning ends the item and reveals both", async () => {
  const verdict = await grade({ subjectId: 3, answer: "intimacy" });

  assert.deepEqual([verdict.wrongMeaning, verdict.wrongReading], [1, 1]);
  assert.match(verdict.say, /^meaning is Parent · reading is しん \(on'yomi\) ·/);
  assert.equal(verdict.open, false, "chasing the reading after a missed meaning isn't worth the turn");
});

test("a missed meaning with the reading already right only reveals the meaning", async () => {
  const verdict = await grade({ subjectId: 3, answer: "intimacy, shin" });

  assert.deepEqual([verdict.wrongMeaning, verdict.wrongReading], [1, 0]);
  assert.match(verdict.say, /^meaning is Parent ·/);
  assert.doesNotMatch(verdict.say, /reading is/);
});

test("a blacklisted meaning is a miss however plausible it looks", async () => {
  const verdict = await grade({ subjectId: 3, answer: "father, shin" });

  assert.equal(verdict.meaning, "incorrect");
});

test("the づ/ず distinction survives, and its other IME spelling still passes", async () => {
  assert.equal((await grade({ subjectId: 4, answer: "reassuring, kokorodzuyoi" })).reading, "correct");
  assert.equal((await grade({ subjectId: 4, answer: "reassuring, kokoroduyoi" })).reading, "correct");

  // ず really is a different kana, and WaniKani marks it wrong — so do we,
  // and it's a plain miss rather than an other-reading re-prompt.
  const miss = await grade({ subjectId: 4, answer: "reassuring, kokorozuyoi" });
  assert.equal(miss.reading, "incorrect");
  assert.equal(miss.wrongReading, 1);
});

test("a meaning-only subject is never asked for a reading", async () => {
  const verdict = await grade({ subjectId: 5, answer: "hook" });

  assert.deepEqual([verdict.reading, verdict.say, verdict.open], [null, null, false]);
});

test("an unknown subject id says so rather than grading nothing", async () => {
  const verdict = await grade({ subjectId: 999, answer: "whatever" });

  assert.match(verdict.error, /No subject 999/);
});

test("a full stop between the halves is a separator, not part of the answer", async () => {
  // Straight from a real session: "to realize. kidzuku", "labratory. kenkyuushitsu".
  const verdict = await grade({ subjectId: 3, answer: "parent. shin" });

  assert.deepEqual(verdict.parsed, { meaning: "parent", reading: "shin" });
  assert.deepEqual([verdict.meaning, verdict.reading], ["correct", "correct"]);
});

test("trailing punctuation doesn't cost a meaning", async () => {
  assert.equal((await grade({ subjectId: 3, answer: "parent." })).meaning, "correct");
  assert.equal((await grade({ subjectId: 5, answer: "hook!" })).meaning, "correct");
});

test("any of the separators people reach for splits the halves", async () => {
  for (const reply of [
    "parent, shin",
    "parent. shin",
    "parent / shin",
    "parent | shin",
    "parent x shin",
    "parent; shin",
    "parent、shin",
    "parent shin",
  ]) {
    const verdict = await grade({ subjectId: 3, answer: reply });
    assert.deepEqual(verdict.parsed, { meaning: "parent", reading: "shin" }, reply);
  }
});

test("a separator that's also an ordinary character needs its whitespace", () => {
  // "X-ray" and "3.5" are answers, not two halves.
  assert.deepEqual(splitAnswer("x-ray. ekkususen", VOCAB.data, true), {
    meaning: "x-ray",
    reading: "ekkususen",
  });
});

test("grading records the miss against the assignment, so nobody has to count", async () => {
  await withTempCacheDir(async () => {
    const { saveQueueOrder, loadGrades } = await import("../lib/queueOrder.js");
    await saveQueueOrder([{ assignmentId: 77, subjectId: 3 }]);

    // Two attempts on one item: a wrong reading, then a right one.
    const first = JSON.parse(
      await captureStdout(() => gradeCommand(client, { subjectId: 3, answer: "parent, mi", json: true })),
    );
    await captureStdout(() => gradeCommand(client, { subjectId: 3, reading: "shin" }));

    assert.equal(first.assignmentId, 77, "resolved from the queue order, not asked for");
    assert.deepEqual(first.recorded, { wrongMeaning: 0, wrongReading: 1 });
    assert.deepEqual(await loadGrades(), { 77: { wrongMeaning: 0, wrongReading: 1 } });
  });
});

test("a re-prompt adds nothing to the record", async () => {
  await withTempCacheDir(async () => {
    const { saveQueueOrder, loadGrades } = await import("../lib/queueOrder.js");
    await saveQueueOrder([{ assignmentId: 77, subjectId: 3 }]);

    await captureStdout(() => gradeCommand(client, { subjectId: 3, answer: "parent, oya" }));

    assert.deepEqual(await loadGrades(), {
      77: { wrongMeaning: 0, wrongReading: 0, awaiting: "reading" },
    });
  });
});

test("--forgive takes an overruled miss back off the record", async () => {
  await withTempCacheDir(async () => {
    const { saveQueueOrder, loadGrades } = await import("../lib/queueOrder.js");
    await saveQueueOrder([{ assignmentId: 77, subjectId: 3 }]);
    await captureStdout(() => gradeCommand(client, { subjectId: 3, answer: "parnet, shin" }));

    const forgiven = JSON.parse(
      await captureStdout(() => gradeCommand(client, { subjectId: 3, forgive: "meaning", json: true })),
    );

    assert.deepEqual(forgiven.recorded, { wrongMeaning: 0, wrongReading: 0 });
    assert.deepEqual(await loadGrades(), { 77: { wrongMeaning: 0, wrongReading: 0 } });
  });
});

test("grading an item that isn't in the queue still works, it just isn't recorded", async () => {
  const verdict = await grade({ subjectId: 3, answer: "parent, shin" });

  assert.equal(verdict.assignmentId, null);
  assert.equal(verdict.recorded, null);
  assert.equal(verdict.meaning, "correct");
});

test("the default output is the line to say and nothing to summarise", async () => {
  // The JSON blob got paraphrased into romaji every time, however loudly the
  // skill file said not to. A bare line gets copied.
  // (These run outside a sitting, so a "not recorded" note follows the line.)
  const said = (options) =>
    withTempCacheDir(async () =>
      (await captureStdout(() => gradeCommand(client, options))).split("\n")[0],
    );

  assert.equal(await said({ subjectId: 3, answer: "parent, shin" }), "✓");
  assert.equal(
    await said({ subjectId: 3, answer: "parent, mi" }),
    "✗ reading is しん (on'yomi) · https://jisho.org/search/親%20%23kanji",
  );
});

test("an item still waiting says so under the line, not inside it", async () => {
  const out = await withTempCacheDir(async () =>
    (await captureStdout(() => gradeCommand(client, { subjectId: 3, answer: "parent, oya" }))).trimEnd(),
  );

  const [line, note] = out.split("\n");
  assert.match(line, /^That's a real reading, but WaniKani wants the on'yomi here/);
  assert.doesNotMatch(line, /^[✓✗]/, "a re-prompt is not a verdict");
  assert.equal(note, "(same item — still their turn)");
});

test("an answer that won't be recorded says so where it can't be missed", async () => {
  // Five silent `assignmentId: null`s in a row is how a whole batch went
  // ungraded before submit-batch noticed.
  const out = await withTempCacheDir(async () =>
    await captureStdout(() => gradeCommand(client, { subjectId: 3, answer: "parent, shin" })),
  );

  assert.match(out, /^! NOT RECORDED — no sitting on disk/m);
  assert.match(out, /submit-batch/);
});
