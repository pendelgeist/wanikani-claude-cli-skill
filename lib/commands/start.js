import { formatRelativeToNow, srsStageName } from "../format.js";

/**
 * Marks lesson assignments as started, which is what "I've learned this one"
 * means to WaniKani: the item enters the SRS and its first review is
 * scheduled. The interactive `lessons --start` flow needs a real terminal to
 * prompt per item, so this is the entry point a Claude-driven lesson session
 * uses once the user says they've got it.
 *
 * Keeps going on a per-item failure, the same way `submit-batch` does, so one
 * bad id doesn't strand the rest.
 */
export async function startCommand(client, { assignmentIds }) {
  const results = [];

  for (const assignmentId of assignmentIds) {
    try {
      const assignment = await client.startAssignment(assignmentId);
      const availableAt = assignment?.data?.available_at ?? null;
      results.push({
        assignmentId,
        ok: true,
        startedAt: assignment?.data?.started_at ?? null,
        srsStage: assignment?.data?.srs_stage ?? null,
        srsStageName: srsStageName(assignment?.data?.srs_stage),
        availableAt,
        firstReviewIn: availableAt ? formatRelativeToNow(availableAt) : null,
      });
    } catch (err) {
      // A 4xx here is settled — already started, or not a lesson assignment —
      // so flag it as not worth retrying, matching submit-batch's contract.
      results.push({
        assignmentId,
        ok: false,
        error: err.message,
        retryable: !(err.status >= 400 && err.status < 500),
      });
    }
  }

  const started = results.filter((result) => result.ok);
  console.log(
    JSON.stringify(
      { results, batch: { started: started.length, failed: results.length - started.length } },
      null,
      2,
    ),
  );
}
