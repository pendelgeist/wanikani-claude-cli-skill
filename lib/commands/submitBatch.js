import { srsStageName, srsTierName, srsTierChange } from "../format.js";
import { markSubmitted, countRemainingReviews } from "../reviewQueue.js";

/**
 * Submits several graded reviews in one process — lets a Claude-driven
 * session collapse N per-item Bash round-trips into one per batch. Keeps
 * going on a per-item failure so one bad assignment id doesn't lose the
 * rest of an otherwise-good batch.
 *
 * Prints `{ results, batch, remaining }`: per-item outcomes (including the
 * SRS movement, so the caller can call out what got promoted or burned),
 * batch totals, and how many reviews are still due.
 */
export async function submitBatchCommand(client, items) {
  const results = [];

  for (const item of items) {
    const wrongMeaning = item.wrongMeaning ?? 0;
    const wrongReading = item.wrongReading ?? 0;
    try {
      const review = await client.submitReview({
        assignmentId: item.assignmentId,
        incorrectMeaningAnswers: wrongMeaning,
        incorrectReadingAnswers: wrongReading,
      });
      const startingSrsStage = review.data.starting_srs_stage;
      const endingSrsStage = review.data.ending_srs_stage;
      results.push({
        assignmentId: item.assignmentId,
        ok: true,
        perfect: wrongMeaning === 0 && wrongReading === 0,
        startingSrsStage,
        endingSrsStage,
        srsStageName: srsStageName(endingSrsStage),
        srsTier: srsTierName(endingSrsStage),
        tierChange: srsTierChange(startingSrsStage, endingSrsStage),
      });
    } catch (err) {
      // A 4xx won't come good on a retry — the assignment is gone, or was
      // already reviewed elsewhere — so clear it out rather than re-quizzing
      // the user on it every batch until the queue expires.
      const retryable = !(err.status >= 400 && err.status < 500);
      results.push({ assignmentId: item.assignmentId, ok: false, error: err.message, retryable });
    }
  }

  const submitted = results.filter((result) => result.ok);
  const abandoned = results.filter((result) => !result.ok && !result.retryable);
  await markSubmitted([...submitted, ...abandoned].map((result) => result.assignmentId));

  console.log(
    JSON.stringify(
      {
        results,
        batch: {
          submitted: submitted.length,
          failed: results.length - submitted.length,
          perfect: submitted.filter((result) => result.perfect).length,
          burned: submitted.filter((result) => result.tierChange === "burned").length,
          promoted: submitted.filter((result) => result.tierChange === "promoted").length,
          demoted: submitted.filter((result) => result.tierChange === "demoted").length,
        },
        remaining: await countRemainingReviews(client),
      },
      null,
      2,
    ),
  );
}
