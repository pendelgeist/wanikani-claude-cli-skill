import { test } from "node:test";
import assert from "node:assert/strict";
import { TIPS, tipsSheet } from "../lib/tips.js";
import { tipsCommand } from "../lib/commands/tips.js";
import { captureStdout } from "./helpers.js";

test("the sheet lists every tip", () => {
  const sheet = tipsSheet();

  for (const tip of TIPS) assert.ok(sheet.includes(tip), `missing from the sheet: ${tip}`);
  assert.match(sheet, /^What you can say:/);
});

test("the sheet leads with the two things worth knowing first", () => {
  // Order is the only ranking a flat list gets, so it's worth asserting.
  assert.match(TIPS[0], /"more"/);
  assert.match(TIPS[1], /one line/);
});

test("the tips command needs no token, no network and no arguments", async () => {
  // No client is passed at all — the sheet is about the tool, not the account.
  const output = await captureStdout(() => tipsCommand());

  assert.match(output, /What you can say:/);
  assert.ok(output.includes(TIPS.at(-1)), "the whole list, not a sample");
});
