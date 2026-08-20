import { getReviewQueue } from "../reviewQueue.js";
import { loadQueueOrder, beginBatch } from "../queueOrder.js";
import { promptFor, correctionsFor, otherReadingHelp, ANSWER_CONVENTION, GRADING_NOTE } from "../present.js";

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
/**
 * Fetches the next batch and makes it *the* batch on record. Shared with
 * `ask`, which serves the same items as a printed question rather than as a
 * payload — one fetch path, so the refusal below can't be reachable from one
 * caller and not the other.
 */
export async function serveNewBatch(client, { limit, restart = false } = {}) {
  const order = await loadQueueOrder();
  if (!restart) refuseToDiscard(order);

  const queue = await getReviewQueue(client, { limit });
  const startOfSitting = (order?.totals?.submitted ?? 0) === 0;

  // Handing an item out means it's about to be answered, so anything already
  // recorded for it belongs to an attempt that didn't finish — drop it rather
  // than let it submit later as if it were this answer. This is also what
  // makes these ten "the batch" for `prompts` and `grade-many`, and writing
  // keeps the sitting alive, the same as grading in it does.
  await beginBatch(queue.map((item) => item.assignmentId));

  return { queue, startOfSitting };
}

export async function queueCommand(client, { limit, answers = false, restart = false } = {}) {
  const { queue, startOfSitting } = await serveNewBatch(client, { limit, restart });

  const payload = queue.map(({ subject, primaryMeaning, primaryReading, ...item }, index) => ({
    assignmentId: item.assignmentId,
    subjectId: item.subjectId,
    subjectType: item.subjectType,
    level: item.level,
    needsReading: item.needsReading,
    // `prompt` already carries the characters (or the image URL for a radical
    // with no glyph), so nothing else here needs to.
    prompt: promptFor(item, index + 1),
    // `convention` is for the user and is said once; `grading` is for whoever
    // is driving and rides along every time, because they may not have been
    // here for the first one.
    ...(index === 0 ? { grading: GRADING_NOTE } : {}),
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

/**
 * Stops a re-fetch from quietly binning a batch that was answered and never
 * submitted.
 *
 * Handing out a batch clears whatever was recorded against those items, which
 * is right when a batch is being re-asked and catastrophic when it isn't: one
 * session graded six items, called `queue` instead of `submit-batch`, got the
 * same ten items back — because nothing had been submitted, so nothing had
 * been pruned — and read that as the API lagging. It then answered them all a
 * second time, did it again on the batch after, and finished a sitting of
 * thirty answers having submitted none of them.
 *
 * The record is the thing worth protecting, so this refuses rather than warns,
 * and says which call to make instead. `--restart` is the deliberate version.
 */
function refuseToDiscard(order) {
  const graded = Object.keys(order?.grades ?? {}).length;
  if (graded === 0) return;

  throw new Error(
    `${graded} answer${graded === 1 ? "" : "s"} graded and not submitted — run \`submit-batch\` first, ` +
      "then `queue` for the next batch.\n" +
      "Fetching now would hand back the same items (nothing is pruned until it's submitted) and bin " +
      `${graded === 1 ? "that answer" : "those answers"} on the way. \`queue --restart\` does that on purpose, ` +
      "when the batch really should be asked again from scratch.",
  );
}
