import { getReviewQueue } from "../reviewQueue.js";
import { loadQueueOrder } from "../queueOrder.js";
import { promptFor, correctionsFor, ANSWER_CONVENTION } from "../present.js";

/**
 * Machine-readable review queue, including the accepted meanings/readings —
 * intended for a Claude Code session to drive the quiz conversationally and
 * grade the user's spoken answers with its own judgment, then call `submit`.
 *
 * `prompt` and `corrections` come pre-composed: the caller prints them rather
 * than building them out of the fields below, which is the difference between
 * a rule to follow and a string to echo. At the start of a sitting the first
 * item also carries `convention`, the how-to-answer note, so that explanation
 * has one sanctioned home instead of being repeated on every prompt.
 */
export async function queueCommand(client, { limit } = {}) {
  const queue = await getReviewQueue(client, { limit });
  const order = await loadQueueOrder();
  const startOfSitting = (order?.totals?.submitted ?? 0) === 0;

  const payload = queue.map((item, index) => ({
    assignmentId: item.assignmentId,
    subjectType: item.subjectType,
    level: item.level,
    characters: item.characters,
    characterImageUrl: item.characterImageUrl,
    documentUrl: item.documentUrl,
    needsReading: item.needsReading,
    prompt: promptFor(item, index + 1),
    ...(index === 0 && startOfSitting ? { convention: ANSWER_CONVENTION } : {}),
    corrections: correctionsFor({
      characters: item.characters,
      documentUrl: item.documentUrl,
      meanings: item.subject.meanings,
      readings: item.subject.readings,
    }),
    meanings: item.subject.meanings,
    auxiliaryMeanings: item.subject.auxiliary_meanings,
    readings: item.subject.readings ?? [],
  }));
  console.log(JSON.stringify(payload, null, 2));
}
