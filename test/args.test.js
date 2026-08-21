import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCount, parsePercentage } from "../lib/args.js";

test("parseCount passes through a valid count", () => {
  assert.equal(parseCount("10", { flag: "--limit", min: 1 }), 10);
  assert.equal(parseCount("0", { flag: "--wrong-meaning" }), 0);
});

test("parseCount leaves an unset option alone", () => {
  assert.equal(parseCount(undefined, { flag: "--limit", min: 1 }), undefined);
});

test("parseCount rejects the values that used to silently mean 'no limit'", () => {
  assert.throws(() => parseCount("abc", { flag: "--limit", min: 1 }), /--limit expects a whole number/);
  assert.throws(() => parseCount("0", { flag: "--limit", min: 1 }), /--limit expects a whole number/);
  assert.throws(() => parseCount("2.5", { flag: "--limit", min: 1 }), /--limit expects a whole number/);
  assert.throws(() => parseCount("", { flag: "--limit", min: 1 }), /--limit expects a whole number/);
});

test("parseCount rejects negative counts", () => {
  assert.throws(() => parseCount("-1", { flag: "--wrong-reading" }), /--wrong-reading expects a whole number/);
});

test("parsePercentage passes through a percentage and leaves an unset option alone", () => {
  assert.equal(parsePercentage("60"), 60);
  assert.equal(parsePercentage(undefined), undefined);
});

test("parsePercentage rejects anything off the 1-100 scale", () => {
  // 750 for 75 is the typo that matters: unchecked, it asks WaniKani for every
  // item under 750% correct, which is the whole account reported as critical.
  assert.throws(() => parsePercentage("750"), /--under expects a whole percentage between 1 and 100/);
  assert.throws(() => parsePercentage("0"), /--under expects a whole percentage between 1 and 100/);
  assert.throws(() => parsePercentage("-5"), /--under expects a whole percentage between 1 and 100/);
  assert.throws(() => parsePercentage("75%"), /--under expects a whole percentage between 1 and 100/);
});
