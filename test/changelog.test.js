import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The changelog is the one file here that is only ever written by hand, and
 * the only one whose errors are invisible: a section dated in the wrong year,
 * or filed under yesterday because that's what the last heading said, reads
 * exactly like a correct one. Every PR that changes behaviour adds to it now
 * (`.github/workflows/changelog.yml` is what insists), so it's worth having
 * the shape checked by something that doesn't get tired.
 *
 * This tests the file, not the code — which is why it asserts on dates and
 * ordering rather than on anything importable.
 */

const CHANGELOG = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const lines = CHANGELOG.split("\n");

// "## 2026-08-22", or "## 2026-07-29 → 2026-08-04" for the stretch before the
// changelog existed, where a day-by-day account would be invented rather than
// recalled.
const HEADING = /^## (\d{4}-\d{2}-\d{2})(?: → (\d{4}-\d{2}-\d{2}))?$/;

/** Every `##` section, in the order they appear. */
function sections() {
  const found = [];
  lines.forEach((line, index) => {
    if (!line.startsWith("## ")) return;
    found.push({ line, index, match: line.match(HEADING) });
  });
  return found;
}

/** A YYYY-MM-DD that means what it says — "2026-02-31" doesn't. */
function parseDay(text) {
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date;
}

test("the changelog opens by saying what it is", () => {
  assert.equal(lines[0], "# Changelog");
});

test("every section is headed by a date, or a range of them", () => {
  const found = sections();
  assert.ok(found.length > 0, "a changelog with no sections is a changelog nobody added to");

  for (const { line, index, match } of found) {
    assert.ok(
      match,
      `line ${index + 1}: "${line}" isn't a date heading — sections are "## YYYY-MM-DD" ` +
        'or "## YYYY-MM-DD → YYYY-MM-DD"',
    );
  }
});

test("the dates are real days, and not ones that haven't happened", () => {
  // A day's grace: CI runs in UTC and whoever wrote the entry may not have.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  for (const { line, match } of sections()) {
    for (const text of match.slice(1).filter(Boolean)) {
      const day = parseDay(text);
      assert.ok(day, `"${line}": ${text} isn't a real date`);
      assert.ok(day <= tomorrow, `"${line}": ${text} is in the future — a typo in the year or month`);
    }
  }
});

test("a range runs oldest to newest", () => {
  for (const { line, match } of sections()) {
    const [, from, to] = match;
    if (!to) continue;
    assert.ok(parseDay(from) < parseDay(to), `"${line}": the range reads backwards`);
  }
});

test("sections are newest first, and a day has one section", () => {
  // Newest-first is the whole navigation: the thing you want is what landed
  // last. A same-day duplicate is the failure this catches most often — two
  // PRs merged on one day, each opening its own heading — and the fix is to
  // add the bullets to the section that's already there.
  const dated = sections().map(({ line, match }) => ({
    line,
    // What a section is filed under is its newest day: the right-hand end of
    // a range, the only date otherwise.
    newest: parseDay(match[2] ?? match[1]),
  }));

  for (let i = 1; i < dated.length; i += 1) {
    const above = dated[i - 1];
    const below = dated[i];
    assert.ok(
      above.newest > below.newest,
      above.newest.getTime() === below.newest.getTime()
        ? `two sections for the same day ("${below.line}") — add to the one that's already there`
        : `"${below.line}" is newer than "${above.line}" above it — sections run newest first`,
    );
  }
});

test("no section is empty", () => {
  const found = sections();
  for (const [position, section] of found.entries()) {
    const end = found[position + 1]?.index ?? lines.length;
    const body = lines.slice(section.index + 1, end).join("").trim();
    assert.notEqual(body, "", `"${section.line}" has a heading and nothing under it`);
  }
});
