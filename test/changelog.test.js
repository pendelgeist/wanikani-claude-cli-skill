import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEntries, newEntries, parseChangelog, summarise } from "../lib/changelog.js";

test("a bullet's summary is its bold lead, or its first line trimmed", () => {
  assert.equal(summarise("**Fix it.** Then a long story."), "Fix it.");
  assert.equal(summarise("plain"), "plain");
  assert.ok(summarise("x".repeat(200)).length <= 98);
});

test("continuation lines are folded into their bullet", () => {
  const [section] = parseChangelog("## D\n\n- one\n  more\n- two\n");
  assert.deepEqual(section.bullets, ["one more", "two"]);
});

test("only bullets missing from the old file are new, under their release", () => {
  const before = "## A\n\n- **Kept.** x\n";
  const after = "## B\n\n- **Fresh.** y\n\n## A\n\n- **Kept.** x\n- **Also fresh.** z\n";
  assert.equal(formatEntries(newEntries(before, after)), "B\n- Fresh.\n\nA\n- Also fresh.");
});

test("no changelog before is everything new; identical files are nothing", () => {
  assert.equal(newEntries("", "## A\n\n- **x.** y\n").length, 1);
  assert.deepEqual(newEntries("## A\n\n- q\n", "## A\n\n- q\n"), []);
});

test("the pull request index at the foot is not a release", () => {
  const after = "## B\n\n- **Fresh.** y\n\n## Pull requests\n\n- [#1](u) · d — t\n";
  assert.deepEqual(newEntries("", after), [{ heading: "B", bullets: ["Fresh."] }]);
});
