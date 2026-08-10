import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCount } from "../lib/args.js";

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
