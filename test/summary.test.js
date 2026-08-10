import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryCommand } from "../lib/commands/summary.js";
import { captureStdout } from "./helpers.js";

const HOUR_MS = 60 * 60 * 1000;

function isoFromNow(hours) {
  return new Date(Date.now() + hours * HOUR_MS).toISOString();
}

/**
 * /summary reports the current hour plus the next 24 hourly buckets, so a
 * realistic response always carries future reviews alongside the due ones.
 */
function fakeClient({ dueNow = 12, upcoming = [30, 40], lessons = 5 } = {}) {
  return {
    async getUser() {
      return {
        data: {
          username: "reviewer",
          level: 12,
          subscription: { active: true, type: "recurring", max_level_granted: 60 },
        },
      };
    },
    async getSummary() {
      return {
        data: {
          lessons: [{ available_at: isoFromNow(-1), subject_ids: Array.from({ length: lessons }, (_, i) => i) }],
          reviews: [
            { available_at: isoFromNow(-1), subject_ids: Array.from({ length: dueNow }, (_, i) => i) },
            ...upcoming.map((count, index) => ({
              available_at: isoFromNow(index + 1),
              subject_ids: Array.from({ length: count }, (_, i) => i),
            })),
          ],
          next_reviews_at: isoFromNow(1),
        },
      };
    },
  };
}

test("summary counts only the reviews already available, not the next 24 hours", async () => {
  const output = await captureStdout(() => summaryCommand(fakeClient(), { json: true }));
  const result = JSON.parse(output);

  assert.equal(result.reviewsAvailable, 12);
  assert.equal(result.reviewsUpcoming24h, 70);
  assert.equal(result.lessonsAvailable, 5);
});

test("summary reports the countdown when nothing is due yet", async () => {
  const output = await captureStdout(() => summaryCommand(fakeClient({ dueNow: 0 })));

  assert.match(output, /Reviews available: 0/);
  assert.match(output, /Coming in the next 24h: 70/);
  assert.match(output, /Next reviews in: /);
});

test("summary omits the countdown while reviews are waiting", async () => {
  const output = await captureStdout(() => summaryCommand(fakeClient()));

  assert.match(output, /Reviews available: 12/);
  assert.doesNotMatch(output, /Next reviews in: /);
});

test("summary survives a user payload without subscription details", async () => {
  const client = fakeClient();
  client.getUser = async () => ({ data: { username: "reviewer", level: 3 } });

  const output = await captureStdout(() => summaryCommand(client));
  assert.match(output, /reviewer — Level 3/);
});
