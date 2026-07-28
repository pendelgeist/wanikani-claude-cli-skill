import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeToNow, srsStageName } from "../lib/format.js";

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
