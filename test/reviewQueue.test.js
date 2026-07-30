import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCharacterImage } from "../lib/reviewQueue.js";

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
