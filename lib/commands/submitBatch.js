import { srsStageName, srsTierName, srsTierChange } from "../format.js";
import { batchSummaryLine } from "../present.js";
import { markSubmitted, countRemainingReviews, charactersForAssignments } from "../reviewQueue.js";
import { addSessionTotals, loadGrades, loadPriorGrades, loadSitting, openItems } from "../queueOrder.js";
import { recordMisses } from "../misses.js";

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
const STDIN_IGNORED =
  "The piped-in list was ignored — `submit-batch` takes no counts. What went in is what `grade` " +
  "recorded, which is why the numbers above are right despite it. Drop the heredoc.";

export async function submitBatchCommand(client, { ignoredStdin = false } = {}) {
  const payload = await submitBatch(client, { ignoredStdin });
  if (payload) console.log(JSON.stringify(payload, null, 2));
}

/**
 * The submission itself, handing back what it would have printed. `ask`
 * submits through here on its way to the next batch, so that finishing a
 * batch and recording it are one step and not two — a session deciding *when*
 * to submit is a decision, and every decision left to the driver has
 * eventually gone wrong.
 */
export async function submitBatch(client, { ignoredStdin = false } = {}) {
  const grades = await loadGrades();
  // An item mid-re-prompt has a record but no answer yet, and submitting that
  // record would send a free pass: nothing wrong on it, because the half that
  // could be wrong hasn't been given. It stays in the queue instead and comes
  // back around, the same as an item nobody reached.
  const batchItems = Object.entries(grades)
    .filter(([, counts]) => !counts.awaiting)
    .map(([assignmentId, counts]) => ({ assignmentId: Number(assignmentId), ...counts }));
  // Everything asked in this batch and not settled — never answered, or left
  // open. The summary names it, because "how many of those ten went in?" is
  // otherwise only answerable by counting chat messages.
  const unanswered = (await openItems())?.length ?? 0;
  // Misses from an earlier pass at the same items, kept when their record was
  // cleared by a re-ask. They belong to this sitting, so they go in with it.
  const prior = await loadPriorGrades();
  // An empty record where a whole batch should be is worth saying out loud:
  // "0 done, 0 perfect" reads like a submitted batch of nothing. Either the
  // answers were never graded, or the sitting aged out (the queue order has a
  // 30-minute life) — in both cases the items are still due, unrecorded.
  if (batchItems.length === 0) {
    // A dead end here once ended a session: ten items answered in chat, none
    // graded, and the conclusion drawn was that the tool didn't support the
    // workflow. So the message is a recipe, with a real id from the sitting in
    // it, rather than a verdict.
    const pending = (await loadSitting())?.items ?? [];
    const example = pending[0]?.subjectId;
    return {
      // Two different dead ends. Nothing on record at all is the answers
      // never reaching `grade`; a record of nothing but open items is a
      // batch that got as far as a re-prompt and stopped.
      summaryLine: Object.keys(grades).length
        ? `Nothing submitted — nothing in this batch is settled, and ${unanswered} item${unanswered === 1 ? " is" : "s are"} ` +
          "still open. `prompts` re-asks them; an item mid-question isn't submitted, because the half " +
          "that could be wrong hasn't been answered. Nothing is lost — they stay due."
        : "Nothing submitted — no grades on record. Answers given in chat aren't seen here; " +
          'each one needs `wanikani grade <subjectId> "<their whole reply>"` as it arrives' +
          (example ? ` (e.g. \`wanikani grade ${example} "substitution, daiyou"\`)` : "") +
          ". Items already answered can still be graded now, one call each — nothing was lost, " +
          "and they stay due until they're submitted. `status` says what the record holds.",
      results: [],
      batch: { submitted: 0, failed: 0, perfect: 0, burned: 0, promoted: 0, demoted: 0 },
      remaining: await countRemainingReviews(client),
      ...(ignoredStdin ? { ignoredStdin: STDIN_IGNORED } : {}),
    };
  }

  const results = [];

  for (const item of batchItems) {
    const carried = prior[item.assignmentId] ?? { wrongMeaning: 0, wrongReading: 0 };
    const wrongMeaning = (item.wrongMeaning ?? 0) + carried.wrongMeaning;
    const wrongReading = (item.wrongReading ?? 0) + carried.wrongReading;
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
        wrongMeaning,
        wrongReading,
        carriedMiss: carried.wrongMeaning + carried.wrongReading > 0,
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

  // Filed before pruning, for the same reason as the names below: an item's
  // subject id lives in the order, and submitting takes it out. This is what
  // `drill` asks from later.
  const subjectIds = new Map(((await loadSitting())?.items ?? []).map((item) => [item.assignmentId, item.subjectId]));
  await recordMisses(
    submitted
      .filter((result) => !result.perfect)
      .map((result) => ({
        subjectId: subjectIds.get(result.assignmentId),
        wrongMeaning: result.wrongMeaning,
        wrongReading: result.wrongReading,
      })),
  );

  // Resolve names before pruning — submitting takes an item out of the order.
  const characters = await charactersForAssignments(
    submitted.filter((result) => result.tierChange).map((result) => result.assignmentId),
  );

  const failed = results.filter((result) => !result.ok);
  const abandoned = failed.filter((result) => !result.retryable);
  await markSubmitted([...submitted, ...abandoned].map((result) => result.assignmentId));
  const totals = await addSessionTotals({ submitted: submitted.length, perfect });

  const carriedMisses = submitted.filter((result) => result.carriedMiss).length;
  const batch = {
    submitted: submitted.length,
    failed: failed.length,
    perfect,
    carriedMisses,
    burned: submitted.filter((result) => result.tierChange === "burned").length,
    promoted: submitted.filter((result) => result.tierChange === "promoted").length,
    demoted: submitted.filter((result) => result.tierChange === "demoted").length,
  };
  const remaining = await countRemainingReviews(client);

  return {
    summaryLine: batchSummaryLine({
      submitted: batch.submitted,
      perfect: batch.perfect,
      unanswered,
      carriedMisses,
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
    // The warning for this goes to stderr, and stderr kept not being the
    // thing that got read: one session piped a hand-written list into
    // every submit of a six-batch sitting, all six ignored, all six
    // unremarked. So it's in the payload too.
    ...(ignoredStdin ? { ignoredStdin: STDIN_IGNORED } : {}),
  };
}
