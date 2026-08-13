import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCharacterImage, subjectView, teachingView } from "../lib/subject.js";

test("pickCharacterImage returns null when there are no images", () => {
  assert.equal(pickCharacterImage(undefined), null);
  assert.equal(pickCharacterImage([]), null);
});

test("pickCharacterImage prefers a plain (no color override) PNG", () => {
  const images = [
    { url: "colored.svg", content_type: "image/svg+xml" },
    { url: "colored.png", content_type: "image/png", metadata: { color: "#ff0000" } },
    { url: "plain.png", content_type: "image/png", metadata: {} },
  ];
  assert.equal(pickCharacterImage(images), "plain.png");
});

test("pickCharacterImage falls back to a colored PNG if no plain one exists", () => {
  const images = [
    { url: "colored.svg", content_type: "image/svg+xml" },
    { url: "colored.png", content_type: "image/png", metadata: { color: "#ff0000" } },
  ];
  assert.equal(pickCharacterImage(images), "colored.png");
});

test("pickCharacterImage falls back to the first image if there's no PNG at all", () => {
  const images = [{ url: "only.svg", content_type: "image/svg+xml" }];
  assert.equal(pickCharacterImage(images), "only.svg");
});

const RADICAL = {
  id: 10,
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

test("subjectView resolves the glyph-less radical's image, so no caller has to", () => {
  const view = subjectView(RADICAL);

  assert.equal(view.characters, null);
  assert.equal(view.characterImageUrl, "https://img/hook.png");
  assert.equal(view.subjectId, 10);
  assert.equal(view.subjectType, "radical");
});

test("subjectView leaves the image alone when there's a glyph to show", () => {
  const view = subjectView({ id: 1, object: "kanji", data: { characters: "親", character_images: [] } });

  assert.equal(view.characterImageUrl, null);
});

test("subjectView gives the answer-key arrays a floor, so callers can map them", () => {
  const view = subjectView({ id: 1, object: "radical", data: {} });

  assert.deepEqual([view.meanings, view.auxiliaryMeanings, view.readings], [[], [], []]);
});

test("teachingView strips WaniKani's markup out of every mnemonic", () => {
  assert.equal(teachingView(RADICAL).meaningMnemonic, "It's a hook.");
  assert.equal(teachingView(RADICAL).readingMnemonic, undefined);
});
