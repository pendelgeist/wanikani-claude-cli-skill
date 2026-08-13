import { test } from "node:test";
import assert from "node:assert/strict";
import { explainCommand } from "../lib/commands/explain.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

const STAND = {
  id: 1,
  object: "radical",
  data: {
    level: 1,
    characters: "立",
    document_url: "https://www.wanikani.com/radicals/stand",
    meanings: [{ meaning: "Stand", primary: true, accepted_answer: true }],
  },
};

const HOOK = {
  id: 2,
  object: "radical",
  data: {
    level: 1,
    characters: null,
    character_images: [{ url: "https://img/hook.png", content_type: "image/png", metadata: {} }],
    document_url: "https://www.wanikani.com/radicals/hook",
    meanings: [{ meaning: "Hook", primary: true, accepted_answer: true }],
    meaning_mnemonic: "It's a <radical>hook</radical>.",
  },
};

const KANJI = {
  id: 3,
  object: "kanji",
  data: {
    level: 2,
    characters: "親",
    document_url: "https://www.wanikani.com/kanji/親",
    meanings: [{ meaning: "Parent", primary: true, accepted_answer: true }],
    readings: [
      { type: "onyomi", primary: true, accepted_answer: true, reading: "しん" },
      { type: "kunyomi", primary: false, accepted_answer: false, reading: "おや" },
    ],
    component_subject_ids: [1, 2],
    meaning_mnemonic: "Your <kanji>parent</kanji> stands there.",
    meaning_hint: "Picture them.",
    reading_mnemonic: "They shin up a tree.",
    reading_hint: "Say it aloud.",
  },
};

const VOCAB = {
  id: 4,
  object: "vocabulary",
  data: {
    level: 2,
    characters: "親",
    document_url: "https://www.wanikani.com/vocabulary/親",
    meanings: [{ meaning: "Parent", primary: true, accepted_answer: true }],
    readings: [{ primary: true, accepted_answer: true, reading: "おや" }],
    parts_of_speech: ["noun"],
    component_subject_ids: [3],
    meaning_mnemonic: "The kanji on its own.",
    context_sentences: [
      { ja: "親に聞いてみる。", en: "I'll ask my parents." },
      { ja: "親と住んでいる。", en: "I live with my parents." },
      { ja: "三つ目。", en: "A third one." },
    ],
  },
};

const ALL = [STAND, HOOK, KANJI, VOCAB];

function fakeClient(subjects = ALL) {
  const client = {
    slugCalls: 0,
    idCalls: [],
    async getSubjectsByIds(ids) {
      client.idCalls.push(ids);
      return new Map(ids.map((id) => [id, subjects.find((s) => s.id === id)]).filter(([, s]) => s));
    },
    async getSubjectsBySlugs(slugs) {
      client.slugCalls += 1;
      return subjects.filter((s) => slugs.includes(s.data.characters));
    },
  };
  return client;
}

const run = (target, options = {}, client = fakeClient()) =>
  withTempCacheDir(async () => ({
    output: await captureStdout(() => explainCommand(client, { target, ...options })),
    client,
  }));

test("explain by subject id gives the mnemonics, the hints and what it's built from", async () => {
  const { output } = await run("3");

  assert.match(output, /^親 — kanji, level 2$/m);
  assert.match(output, /Meaning: Parent/);
  assert.match(output, /Meaning mnemonic: Your parent stands there\./, "markup is stripped");
  assert.match(output, /Hint: Picture them\./);
  assert.match(output, /Reading mnemonic: They shin up a tree\./);
  assert.match(output, /Parts: 立 \(Stand\) \+ \[Hook\]/, "a glyph-less part is named instead");
});

test("explain says which reading is wanted and which ones aren't", async () => {
  const { output } = await run("3");

  assert.match(output, /Reading: しん \(on'yomi\) — also read おや \(kun'yomi\), though not here/);
});

test("explain links WaniKani and Jisho, and doesn't repeat itself for a radical", async () => {
  const { output: kanji } = await run("3");
  assert.match(kanji, /More: https:\/\/www\.wanikani\.com\/kanji\/親 · https:\/\/jisho\.org\/search\/親%20%23kanji$/m);

  const { output: radical } = await run("2");
  assert.match(radical, /More: https:\/\/www\.wanikani\.com\/radicals\/hook$/m);
});

test("explain shows a glyph-less radical's image, since there's no glyph to show", async () => {
  const { output } = await run("2");

  assert.match(output, /^\[Hook\] — radical, level 1$/m);
  assert.match(output, /Image: https:\/\/img\/hook\.png/);
});

test("explain trims context sentences to a couple rather than the whole list", async () => {
  const { output } = await run("4");

  assert.match(output, /Example: 親に聞いてみる。 — I'll ask my parents\./);
  assert.doesNotMatch(output, /三つ目/, "a third example is more than 'more'");
  assert.match(output, /^親 — vocabulary, level 2, noun$/m);
});

test("explain by characters covers every subject that shares them", async () => {
  // 親 is a kanji and a word, and which one they mean isn't knowable — so both.
  const { output } = await run("親");

  assert.match(output, /親 — kanji, level 2/);
  assert.match(output, /親 — vocabulary, level 2/);
});

test("explain by characters answers from the session's cache without an API call", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    await captureStdout(() => explainCommand(client, { target: "3" })); // warms the cache
    client.idCalls = [];

    await captureStdout(() => explainCommand(client, { target: "親" }));

    assert.equal(client.slugCalls, 0, "the item just answered is already cached");
    assert.deepEqual(client.idCalls, [], "and so are its parts");
  });
});

test("explain --json hands over the fields rather than the block", async () => {
  const { output } = await run("3", { json: true });
  const [item] = JSON.parse(output);

  assert.equal(item.subjectId, 3);
  assert.equal(item.meaningHint, "Picture them.");
  assert.deepEqual(item.components, [
    { characters: "立", meaning: "Stand" },
    { characters: null, meaning: "Hook" },
  ]);
});

test("explain says so plainly when nothing matches", async () => {
  const { output } = await run("💥");

  assert.match(output, /Nothing found for "💥"/);
  assert.match(output, /subjectId/, "and says what would have worked");
});
