import { getReviewQueue } from "../reviewQueue.js";
import { loadQueueOrder, beginBatch } from "../queueOrder.js";
import { promptFor, correctionsFor, otherReadingHelp, ANSWER_CONVENTION } from "../present.js";

/**
 * The batch to ask, and nothing that answers it.
 *
 * This used to hand over the whole answer key — meanings, readings, ready-made
 * correction lines — so that a session could grade in chat. What that actually
 * bought was hand-grading as the path of least resistance, and hand-grading is
 * where every recurring bug came from. One real session graded twenty items
 * itself and never called `grade` once: romaji in every correction, not one
 * lookup link, a mis-stated batch tally, a mnemonic declared not to exist
 * without looking, one item answered by the session on the user's behalf, and
 * the next item's meaning printed above its own prompt.
 *
 * None of those are possible without the key. `grade` holds it, `explain`
 * shows it when asked, and what comes back from here is a question plus the
 * two ids needed to act on it. `--answers` restores the old shape for
 * debugging the CLI itself.
 */
export async function queueCommand(client, { limit, answers = false } = {}) {
  const queue = await getReviewQueue(client, { limit });
  const order = await loadQueueOrder();
  const startOfSitting = (order?.totals?.submitted ?? 0) === 0;

  // Handing an item out means it's about to be answered, so anything already
  // recorded for it belongs to an attempt that didn't finish — drop it rather
  // than let it submit later as if it were this answer. This is also what
  // makes these ten "the batch" for `prompts` and `grade-many`, and writing
  // keeps the sitting alive, the same as grading in it does.
  await beginBatch(queue.map((item) => item.assignmentId));

  const payload = queue.map(({ subject, primaryMeaning, primaryReading, ...item }, index) => ({
    assignmentId: item.assignmentId,
    subjectId: item.subjectId,
    subjectType: item.subjectType,
    level: item.level,
    needsReading: item.needsReading,
    // `prompt` already carries the characters (or the image URL for a radical
    // with no glyph), so nothing else here needs to.
    prompt: promptFor(item, index + 1),
    ...(index === 0 && startOfSitting ? { convention: ANSWER_CONVENTION } : {}),
    ...(answers
      ? {
          characters: item.characters,
          characterImageUrl: item.characterImageUrl,
          documentUrl: item.documentUrl,
          corrections: correctionsFor(item),
          ...otherReadingHelp(item),
          meanings: item.meanings,
          auxiliaryMeanings: item.auxiliaryMeanings,
          readings: item.readings,
        }
      : {}),
  }));

  console.log(JSON.stringify(payload, null, 2));
}
