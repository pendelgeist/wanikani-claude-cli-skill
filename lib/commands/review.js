import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getReviewQueue } from "../reviewQueue.js";
import { isMeaningCorrect, isReadingCorrect } from "../grading.js";
import { srsStageName } from "../format.js";

async function quizPart({ rl, label, isCorrect, answer }) {
  let wrong = 0;
  for (;;) {
    const input = await rl.question(`  ${label}> `);
    const trimmed = input.trim();
    if (trimmed === ":quit") return { wrong, quit: true };
    if (trimmed === ":show") {
      console.log(`  (answer: ${answer})`);
      return { wrong: wrong + 1, quit: false };
    }
    if (isCorrect(trimmed)) return { wrong, quit: false };
    wrong += 1;
    console.log("  ✗ not quite — try again (:show to reveal, :quit to stop the session)");
  }
}

export async function reviewCommand(client, { limit } = {}) {
  const queue = await getReviewQueue(client, { limit });
  if (queue.length === 0) {
    console.log("No reviews due right now.");
    return;
  }

  console.log(
    `${queue.length} review${queue.length === 1 ? "" : "s"} due. ` +
      `(":show" reveals an answer, ":quit" ends the session early — completed items are still submitted.)`,
  );

  const rl = createInterface({ input: stdin, output: stdout });
  let itemsDone = 0;
  let perfectItems = 0;

  try {
    for (const item of queue) {
      // documentUrl is withheld until after grading below — for kanji/vocab
      // it's a live link straight to WaniKani's answer page, and for a
      // radical its URL slug is the radical's name, so showing either one
      // before the user answers would just hand them the answer.
      console.log(`\n${item.characters ?? "(radical has no Unicode glyph — image link below once answered)"}`);

      const meaningResult = await quizPart({
        rl,
        label: "meaning",
        isCorrect: (input) => isMeaningCorrect(input, item.subject),
        answer: item.primaryMeaning,
      });
      if (meaningResult.quit) break;

      let wrongReading = 0;
      if (item.needsReading) {
        const readingResult = await quizPart({
          rl,
          label: "reading",
          isCorrect: (input) => isReadingCorrect(input, item.subject),
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

      itemsDone += 1;
      const wasPerfect = meaningResult.wrong === 0 && wrongReading === 0;
      if (wasPerfect) perfectItems += 1;
      console.log(`  → ${srsStageName(review.data.ending_srs_stage)}${wasPerfect ? " ✓" : ""}`);
      console.log(`  (${item.documentUrl})`);
    }
  } finally {
    rl.close();
  }

  console.log(`\n${itemsDone} reviewed, ${perfectItems} perfect.`);
}
