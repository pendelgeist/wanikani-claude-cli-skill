import { test } from "node:test";
import assert from "node:assert/strict";
import { TIPS, nextUnseenTip, markTipSeen, resetTipsSeen, tipsSheet } from "../lib/tips.js";
import { tipsCommand } from "../lib/commands/tips.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

test("tips come out one at a time, in order, and run out", async () => {
  await withTempCacheDir(async () => {
    const rotating = TIPS.filter((tip) => !tip.inConvention);
    const shown = [];

    for (let i = 0; i < rotating.length; i++) {
      const tip = await nextUnseenTip();
      shown.push(tip.id);
      await markTipSeen(tip.id);
    }

    assert.deepEqual(shown, rotating.map((tip) => tip.id));
    assert.equal(await nextUnseenTip(), null, "advertising that never stops is wallpaper");
  });
});

test("a tip the sitting note already gives never takes a turn in the rotation", async () => {
  await withTempCacheDir(async () => {
    // "more" is in the convention printed at the start of every sitting;
    // hearing it again ten items later reads like a bug.
    const inConvention = TIPS.filter((tip) => tip.inConvention);
    assert.ok(inConvention.length > 0, "this test is about the ones the note carries");

    for (let i = 0; i < TIPS.length; i++) {
      const tip = await nextUnseenTip();
      if (!tip) break;
      assert.equal(tip.inConvention, undefined);
      await markTipSeen(tip.id);
    }
  });
});

test("tips --reset starts the rotation over", async () => {
  await withTempCacheDir(async () => {
    const first = await nextUnseenTip();
    await markTipSeen(first.id);
    assert.notEqual((await nextUnseenTip()).id, first.id);

    await resetTipsSeen();

    assert.equal((await nextUnseenTip()).id, first.id);
  });
});

test("a cache that can't be read costs a tip, not the call", async () => {
  const previous = process.env.WANIKANI_CACHE_DIR;
  process.env.WANIKANI_CACHE_DIR = "/dev/null/not-a-directory";
  try {
    await assert.doesNotReject(() => nextUnseenTip());
    await assert.doesNotReject(() => markTipSeen("more"));
  } finally {
    if (previous === undefined) delete process.env.WANIKANI_CACHE_DIR;
    else process.env.WANIKANI_CACHE_DIR = previous;
  }
});

test("the sheet lists every tip and marks the ones still to come", async () => {
  const sheet = tipsSheet(new Set(["one-line"]));

  for (const tip of TIPS) assert.ok(sheet.includes(tip.text), `${tip.id} is missing from the sheet`);
  assert.match(sheet, /· Meaning and reading go on one line/, "a tip already shown isn't news");
  assert.match(sheet, /▸ Answering a kanji with another/, "one still to come is");
});

test("the tips command needs no token and no network", async () => {
  await withTempCacheDir(async () => {
    // No client is passed at all — the sheet is about the tool, not the account.
    const output = await captureStdout(() => tipsCommand());

    assert.match(output, /What you can say:/);
    assert.match(output, /tips --reset/);
  });
});

test("tips --reset says it did, then shows the sheet", async () => {
  await withTempCacheDir(async () => {
    await markTipSeen("one-line");

    const output = await captureStdout(() => tipsCommand({ reset: true }));

    assert.match(output, /Tips reset/);
    assert.match(output, /▸ Meaning and reading go on one line/, "reset means unseen again");
  });
});
