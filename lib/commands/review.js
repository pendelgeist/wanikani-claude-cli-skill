import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getReviewQueue, markSubmitted, countRemainingReviews } from "../reviewQueue.js";
import { isMeaningCorrect, readingVerdict } from "../grading.js";
import { readingNudgeFor } from "../present.js";
import { srsStageName, srsTierChange } from "../format.js";

/**
 * Reads answers a line at a time. `rl.question` only listens for one line at
 * a time, so anything that arrives between two questions is dropped — fine
 * when a human is typing, but it silently loses every answer after the first
 * when stdin is a pipe. Pulling from the interface's async iterator keeps the
 * stream paused between reads instead. Resolves to null once stdin ends.
 */
function lineReader(rl, output) {
  const lines = rl[Symbol.asyncIterator]();
  return async (prompt) => {
    output.write(prompt);
    const { value, done } = await lines.next();
    return done ? null : value;
  };
}

/**
 * `judge` returns `{ correct: true }`, `{ retry: "…" }` for an answer that
 * asks again without counting (the website's shake), or anything else for a
 * miss.
 */
async function quizPart({ ask, label, judge, answer }) {
  let wrong = 0;
  for (;;) {
    const input = await ask(`  ${label}> `);
    if (input === null) return { wrong, quit: true }; // stdin ended — stop like :quit
    const trimmed = input.trim();
    if (trimmed === ":quit") return { wrong, quit: true };
    if (trimmed === ":show") {
      console.log(`  (answer: ${answer})`);
      return { wrong: wrong + 1, quit: false };
    }
    const verdict = judge(trimmed);
    if (verdict.correct) return { wrong, quit: false };
    if (verdict.retry) {
      console.log(`  ~ ${verdict.retry}`);
      continue;
    }
    wrong += 1;
    console.log("  ✗ not quite — try again (:show to reveal, :quit to stop the session)");
  }
}

function summarize(tierChanges) {
  const counts = { burned: 0, promoted: 0, demoted: 0 };
  for (const change of tierChanges) counts[change] += 1;

  const parts = [];
  if (counts.promoted) parts.push(`${counts.promoted} moved up a tier`);
  if (counts.burned) parts.push(`${counts.burned} burned`);
  if (counts.demoted) parts.push(`${counts.demoted} slipped back`);
  return parts.join(", ");
}

export async function reviewCommand(client, { limit, input = stdin, output = stdout } = {}) {
  const queue = await getReviewQueue(client, { limit });
  if (queue.length === 0) {
    console.log("No reviews due right now.");
    return;
  }

  console.log(
    `${queue.length} review${queue.length === 1 ? "" : "s"} due. ` +
      `(":show" reveals an answer, ":quit" ends the session early — completed items are still submitted.)`,
  );

  const rl = createInterface({ input, output });
  const ask = lineReader(rl, output);
  let itemsDone = 0;
  let perfectItems = 0;
  const tierChanges = [];

  try {
    for (const item of queue) {
      // documentUrl and the character image are withheld until after grading —
      // for kanji/vocab the document URL is a live link straight to WaniKani's
      // answer page, and for a radical its URL slug is the radical's name.
      console.log(`\n${item.characters ?? "(radical with no Unicode glyph — image below once answered)"}`);

      const meaningResult = await quizPart({
        ask,
        label: "meaning",
        judge: (input) => ({ correct: isMeaningCorrect(input, item.subject) }),
        answer: item.primaryMeaning,
      });
      if (meaningResult.quit) break;

      let wrongReading = 0;
      if (item.needsReading) {
        const readingResult = await quizPart({
          ask,
          label: "reading",
          // Another of the kanji's real readings re-prompts (naming the type
          // wanted) instead of counting against the item, as on the website.
          judge: (input) => {
            const verdict = readingVerdict(input, item.subject);
            if (verdict.status === "correct") return { correct: true };
            if (verdict.status === "other-reading") {
              return { retry: readingNudgeFor(verdict.wantedType) };
            }
            return {};
          },
          answer: item.primaryReading,
        });
        if (readingResult.quit) break;
        wrongReading = readingResult.wrong;
      }

      const review = await client.submitReview({
        assignmentId: item.assignmentId,
        incorrectMeaningAnswers: meaningResult.wrong,
        incorrectReadingAnswers: wrongReading,
      });
      await markSubmitted([item.assignmentId]);

      itemsDone += 1;
      const wasPerfect = meaningResult.wrong === 0 && wrongReading === 0;
      if (wasPerfect) perfectItems += 1;

      const change = srsTierChange(review.data.starting_srs_stage, review.data.ending_srs_stage);
      if (change) tierChanges.push(change);

      const marker = change === "burned" ? " 🔥" : change === "promoted" ? " ↑" : change === "demoted" ? " ↓" : "";
      console.log(`  → ${srsStageName(review.data.ending_srs_stage)}${marker}${wasPerfect ? " ✓" : ""}`);
      if (item.characterImageUrl) console.log(`  (${item.characterImageUrl})`);
      console.log(`  (${item.documentUrl})`);
    }
  } finally {
    rl.close();
  }

  const highlights = summarize(tierChanges);
  const remaining = await countRemainingReviews(client);
  console.log(
    `\n${itemsDone} reviewed, ${perfectItems} perfect.` +
      (highlights ? ` ${highlights}.` : "") +
      (remaining === null ? "" : ` ${remaining} still due.`),
  );
}
