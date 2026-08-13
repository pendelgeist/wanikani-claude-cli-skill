import { srsStageName, srsTierName, srsTierChange } from "../format.js";
import { batchSummaryLine } from "../present.js";
import { markSubmitted, countRemainingReviews, charactersForAssignments } from "../reviewQueue.js";
import { addSessionTotals, loadGrades } from "../queueOrder.js";

/**
 * Submits several graded reviews in one process — lets a Claude-driven
 * session collapse N per-item Bash round-trips into one per batch. Keeps
 * going on a per-item failure so one bad assignment id doesn't lose the
 * rest of an otherwise-good batch.
 *
 * Prints `{ summaryLine, results, batch, remaining }`. `summaryLine` is the
 * end-of-batch line ready to print; the rest is there for anything that wants
 * to say more than the line does.
 *
 * It takes no list: `grade` has been recording each item's wrong-answer
 * counts as they happened, so this submits exactly what was graded. Hand-fed
 * counts used to be an option and were how one real batch went in mis-tallied
 * — "9 perfect, 1 with errors" for a batch with two — so the arithmetic isn't
 * anyone's to do any more. An overruled verdict is corrected at the source,
 * with `grade <subjectId> --forgive meaning|reading`.
 */
export async function submitBatchCommand(client) {
  const grades = await loadGrades();
  const batchItems = Object.entries(grades).map(([assignmentId, counts]) => ({
    assignmentId: Number(assignmentId),
    ...counts,
  }));
  // An empty record where a whole batch should be is worth saying out loud:
  // "0 done, 0 perfect" reads like a submitted batch of nothing. Either the
  // answers were never graded, or the sitting aged out (the queue order has a
  // 30-minute life) — in both cases the items are still due, unrecorded.
  if (batchItems.length === 0) {
    console.log(
      JSON.stringify(
        {
          summaryLine:
            "Nothing submitted — no grades on record. Each answer needs " +
            '`wanikani grade <subjectId> "<their reply>"` as it comes in; that record is what ' +
            "this submits. Nothing was lost: those items are still due.",
          results: [],
          batch: { submitted: 0, failed: 0, perfect: 0, burned: 0, promoted: 0, demoted: 0 },
          remaining: await countRemainingReviews(client),
        },
        null,
        2,
      ),
    );
    return;
  }

  const results = [];

  for (const item of batchItems) {
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

  const failed = results.filter((result) => !result.ok);
  const abandoned = failed.filter((result) => !result.retryable);
  await markSubmitted([...submitted, ...abandoned].map((result) => result.assignmentId));
  const totals = await addSessionTotals({ submitted: submitted.length, perfect });

  const batch = {
    submitted: submitted.length,
    failed: failed.length,
    perfect,
    burned: submitted.filter((result) => result.tierChange === "burned").length,
    promoted: submitted.filter((result) => result.tierChange === "promoted").length,
    demoted: submitted.filter((result) => result.tierChange === "demoted").length,
  };
  const remaining = await countRemainingReviews(client);

  console.log(
    JSON.stringify(
      {
        summaryLine: batchSummaryLine({
          submitted: batch.submitted,
          perfect: batch.perfect,
          failures: { retryable: failed.length - abandoned.length, dropped: abandoned.length },
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
        }),
        results,
        batch,
        remaining,
      },
      null,
      2,
    ),
  );
}
