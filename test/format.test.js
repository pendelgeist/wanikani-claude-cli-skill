import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeToNow, srsStageName, srsTierName, srsTierChange } from "../lib/format.js";

test("formatRelativeToNow returns 'now' for past/present timestamps", () => {
  assert.equal(formatRelativeToNow(new Date(Date.now() - 1000).toISOString()), "now");
});

test("formatRelativeToNow formats minutes", () => {
  const in30Min = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  assert.equal(formatRelativeToNow(in30Min), "30m");
});

test("formatRelativeToNow formats hours and minutes", () => {
  const in2h15m = new Date(Date.now() + (2 * 60 + 15) * 60 * 1000).toISOString();
  assert.equal(formatRelativeToNow(in2h15m), "2h 15m");
});

test("formatRelativeToNow formats whole days", () => {
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(formatRelativeToNow(in3Days), "3d");
});

test("formatRelativeToNow handles null", () => {
  assert.equal(formatRelativeToNow(null), "unknown");
});

test("srsStageName maps known stages", () => {
  assert.equal(srsStageName(0), "Lesson");
  assert.equal(srsStageName(5), "Guru 1");
  assert.equal(srsStageName(9), "Burned");
});

test("srsStageName falls back for out-of-range stages", () => {
  assert.equal(srsStageName(42), "Stage 42");
});

test("srsTierName groups stages into the tiers people actually talk about", () => {
  assert.equal(srsTierName(0), "Lesson");
  assert.equal(srsTierName(1), "Apprentice");
  assert.equal(srsTierName(4), "Apprentice");
  assert.equal(srsTierName(5), "Guru");
  assert.equal(srsTierName(7), "Master");
  assert.equal(srsTierName(8), "Enlightened");
  assert.equal(srsTierName(9), "Burned");
});

test("srsTierChange only flags movement across a tier boundary", () => {
  assert.equal(srsTierChange(2, 3), null); // Apprentice 2 -> 3 is not news
  assert.equal(srsTierChange(4, 5), "promoted"); // ...reaching Guru is
  assert.equal(srsTierChange(6, 7), "promoted");
  assert.equal(srsTierChange(8, 9), "burned");
  assert.equal(srsTierChange(5, 3), "demoted");
});

test("srsTierChange tolerates a response without stage data", () => {
  assert.equal(srsTierChange(undefined, 5), null);
  assert.equal(srsTierName(undefined), "Stage undefined");
});
