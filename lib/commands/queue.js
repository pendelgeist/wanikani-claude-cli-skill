import { getReviewQueue } from "../reviewQueue.js";
import { loadQueueOrder } from "../queueOrder.js";
import { promptFor, correctionsFor, otherReadingHelp, ANSWER_CONVENTION } from "../present.js";

/**
 * Machine-readable review queue, including the accepted meanings/readings —
 * intended for a Claude Code session to drive the quiz conversationally and
 * grade the user's spoken answers with its own judgment, then call `submit`.
 *
 * `prompt`, `corrections` and `readingNudge` come pre-composed: the caller
 * prints them rather than building them out of the fields below, which is the
 * difference between a rule to follow and a string to echo. At the start of a
 * sitting the first item also carries `convention`, the how-to-answer note, so
 * that explanation has one sanctioned home instead of riding on every prompt.
 */
export async function queueCommand(client, { limit } = {}) {
  const queue = await getReviewQueue(client, { limit });
  const order = await loadQueueOrder();
  const startOfSitting = (order?.totals?.submitted ?? 0) === 0;

  // The strings to print lead; the raw answer key follows. Same fields either
  // way, but the reader meets `prompt` before three screens of `readings`.
  const payload = queue.map(({ subject, primaryMeaning, primaryReading, ...item }, index) => ({
    assignmentId: item.assignmentId,
    subjectId: item.subjectId,
    prompt: promptFor(item, index + 1),
    ...(index === 0 && startOfSitting ? { convention: ANSWER_CONVENTION } : {}),
    corrections: correctionsFor(item),
    ...otherReadingHelp(item),
    ...item,
  }));

  console.log(JSON.stringify(payload, null, 2));
}
