import { srsStageName, srsTierName, srsTierChange } from "../format.js";
import { batchSummaryLine } from "../present.js";
import { markSubmitted, countRemainingReviews, charactersForAssignments } from "../reviewQueue.js";
import { addSessionTotals } from "../queueOrder.js";
import { nextUnseenTip, markTipSeen } from "../tips.js";

/**
 * Submits several graded reviews in one process — lets a Claude-driven
 * session collapse N per-item Bash round-trips into one per batch. Keeps
 * going on a per-item failure so one bad assignment id doesn't lose the
 * rest of an otherwise-good batch.
 *
 * Prints `{ summaryLine, results, batch, remaining }`. `summaryLine` is the
 * end-of-batch line ready to print; the rest is there for anything that wants
 * to say more than the line does.
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
  const perfect = submitted.filter((result) => result.perfect).length;

  // Resolve names before pruning — submitting takes an item out of the order.
  const characters = await charactersForAssignments(
    submitted.filter((result) => result.tierChange).map((result) => result.assignmentId),
  );

  const abandoned = results.filter((result) => !result.ok && !result.retryable);
  await markSubmitted([...submitted, ...abandoned].map((result) => result.assignmentId));
  const totals = await addSessionTotals({ submitted: submitted.length, perfect });

  const batch = {
    submitted: submitted.length,
    failed: results.length - submitted.length,
    perfect,
    burned: submitted.filter((result) => result.tierChange === "burned").length,
    promoted: submitted.filter((result) => result.tierChange === "promoted").length,
    demoted: submitted.filter((result) => result.tierChange === "demoted").length,
  };
  const remaining = await countRemainingReviews(client);
  // One feature they haven't been told about yet, riding out on the summary
  // they were going to read anyway. Runs out once they've all been shown.
  const tip = await nextUnseenTip();

  console.log(
    JSON.stringify(
      {
        summaryLine: batchSummaryLine({
          submitted: batch.submitted,
          perfect: batch.perfect,
          failed: batch.failed,
          highlights: submitted
            .filter((result) => result.tierChange)
            .map((result) => ({
              characters: characters.get(result.assignmentId) ?? null,
              tierChange: result.tierChange,
              endingSrsStage: result.endingSrsStage,
            })),
          remaining,
          sessionSubmitted: totals?.submitted ?? null,
          sessionPerfect: totals?.perfect ?? null,
          tip: tip?.text ?? null,
        }),
        results,
        batch,
        remaining,
      },
      null,
      2,
    ),
  );

  if (tip) await markTipSeen(tip.id);
}
