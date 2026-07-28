import { srsStageName } from "../format.js";

/**
 * Submits several graded reviews in one process — lets a Claude-driven
 * session collapse N per-item Bash round-trips into one per batch. Keeps
 * going on a per-item failure so one bad assignment id doesn't lose the
 * rest of an otherwise-good batch.
 */
export async function submitBatchCommand(client, items) {
  const results = [];
  for (const item of items) {
    try {
      const review = await client.submitReview({
        assignmentId: item.assignmentId,
        incorrectMeaningAnswers: item.wrongMeaning ?? 0,
        incorrectReadingAnswers: item.wrongReading ?? 0,
      });
      results.push({
        assignmentId: item.assignmentId,
        ok: true,
        endingSrsStage: review.data.ending_srs_stage,
        srsStageName: srsStageName(review.data.ending_srs_stage),
      });
    } catch (err) {
      results.push({ assignmentId: item.assignmentId, ok: false, error: err.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}
