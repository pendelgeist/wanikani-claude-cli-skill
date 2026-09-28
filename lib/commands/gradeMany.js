import { openItems } from "../queueOrder.js";
import { getSubjectsCached } from "../subjectCache.js";
import { findMisalignment } from "../alignment.js";
import { CARRY_ON, misalignedLine } from "../present.js";
import { gradeAnswer, verdictLines } from "./grade.js";
import { NO_BATCH, openPromptList, stillOpenLine } from "./prompts.js";

// One divider for the list, the one the how-to line names. `grade` also
// accepts `|` *inside* an answer, which is the reason this refuses a reply
// with more parts than there are open items rather than guessing which pipes
// were boundaries: a misaligned batch grades ten right answers as ten wrong
// ones against the wrong items, and nobody would see it until submit.
// The full-width bar is the same key with a Japanese IME switched on, which
// it often is mid-sitting for anyone answering readings in kana.
const ITEM_SEPARATOR = /\s*[|｜]\s*|\s*\n+\s*/;

// What a list gets typed with when the bar isn't to hand: "become sei;
// correct atari; …" or the same with commas. Each of these also divides a
// meaning from a reading *inside* one answer ("fur, ke"), so they only count
// as item boundaries when the reply has no bar or line break at all and they
// cut it into a list-sized number of pieces — see `splitReplies`.
const FALLBACK_SEPARATORS = [/\s*;\s*/, /\s*[,、]\s*/, /\s+\/\s+/];
const FALLBACK_MIN_ITEMS = 3;

/**
 * Grades a whole batch answered in one message, positionally: first answer to
 * the first item still open, and so on down the list `prompts` printed.
 *
 * This is the other half of rapid-fire. The list of questions comes from the
 * CLI so it can't be recalled wrong, and the mapping back from "nine answers
 * on one line" to nine subject ids happens here for the same reason — it's
 * counting, against a list this process already holds, and counting is not
 * something to do in prose nine items deep into a batch.
 */
export async function gradeManyCommand(client, { answers, json = false } = {}) {
  const open = await openItems();
  if (!open) {
    console.log(`! ${NO_BATCH}`);
    return;
  }
  if (open.length === 0) {
    console.log("! Nothing open — every item in this batch is answered. Next: `submit-batch`.");
    return;
  }

  const replies = splitReplies(answers, { open: open.length });
  if (replies.length > open.length) {
    console.log(
      `! ${replies.length} answers for ${open.length} open item${open.length === 1 ? "" : "s"} — nothing graded. ` +
        'Items are separated by "|", so an answer containing one splits in two; ' +
        "re-send them matching the list, or grade the odd one out on its own.",
    );
    return;
  }

  // Before anything is recorded: does this reply actually answer the questions
  // it's about to be graded against? A short list is ordinarily somebody
  // answering a few and keeping the rest — and it is also what a skipped item
  // in the middle looks like, which grades every answer after it against the
  // question before it. See lib/alignment.js for the sitting that cost.
  const subjects = await getSubjectsCached(client, [...new Set(open.map((item) => item.subjectId))]);
  const inOrder = open.map((item) => subjects.get(item.subjectId) ?? null);
  const skew = findMisalignment(replies, inOrder);
  if (skew) {
    console.log(`! ${misalignedLine({ open, replies, ...skew })}`);
    // The questions again, right under the refusal. Asking for the batch a
    // second time and leaving them to find it is how a re-send comes back
    // misaligned the same way.
    console.log(await openPromptList(client, open, { convention: false }));
    return;
  }

  const verdicts = [];
  for (const [index, item] of open.entries()) {
    const reply = replies[index];
    // A gap in the list — "a || c", or simply a short reply — is an item they
    // didn't answer, not a wrong answer. It stays open and gets re-asked.
    if (!reply) continue;
    const verdict = await gradeAnswer(client, { subjectId: item.subjectId, answer: reply });
    verdicts.push({ ...verdict, position: item.position, answer: reply });
  }

  if (json) {
    console.log(JSON.stringify(verdicts, null, 2));
    return;
  }

  for (const verdict of verdicts) {
    const name = verdict.characters ? `${verdict.position}. ${verdict.characters}` : `${verdict.position}.`;
    // The per-item marker lines belong to a one-item exchange; here the item
    // number carries that, and the tail below says which are still open.
    const [line, ...rest] = verdictLines(verdict, { label: name });
    console.log(line);
    for (const note of rest) if (note.startsWith("!")) console.log(note);
  }

  // The leftovers, re-asked here rather than pointed at. A round that ends
  // with one item open is the common shape — an other-reading nudge doesn't
  // settle the item — and the old tail named its number and left the driver
  // to fetch the question with a second call. Three of those in one sitting,
  // each one a round trip to learn what this call already knew.
  const stillOpen = (await openItems()) ?? [];
  const tail = stillOpenLine(stillOpen);
  if (tail) {
    console.log(tail);
    console.log(await openPromptList(client, stillOpen, { convention: false }));
  } else if (verdicts.length > 0) {
    // The batch is answered and this is the pause before the next one — the
    // verdicts are on screen and still overrulable. Their "next" is what
    // `ask --all` submits and serves on.
    console.log(`\n${CARRY_ON}`);
  }
}

/**
 * The reply, split into one answer per item. Trailing empties are dropped
 * because a trailing "|" is how people type a list; interior ones are kept,
 * because that's someone skipping an item.
 *
 * With `open` — how many items the list is answering — a reply with no bar
 * in it is also tried as a list on `;`, `,` and ` / `. It takes the first of
 * those that yields at least three pieces and no more than there are open
 * items. Fewer than three is what one answer with a comma in it looks like
 * ("fur, ke"; "to fall, korobu"), and more than the list is one with commas
 * both between and inside the answers, which nothing can split reliably. Two
 * items open is below the line on purpose: "fur, ke" there would be two
 * answers. Whatever this produces still goes through the alignment check
 * before anything is recorded.
 */
export function splitReplies(raw, { open = null } = {}) {
  const text = raw ?? "";
  let parts = text.split(ITEM_SEPARATOR).map((part) => part.trim());
  if (parts.length === 1 && open !== null && open >= FALLBACK_MIN_ITEMS) {
    for (const separator of FALLBACK_SEPARATORS) {
      const pieces = text.split(separator).map((part) => part.trim());
      while (pieces.length > 0 && pieces.at(-1) === "") pieces.pop();
      if (pieces.length >= FALLBACK_MIN_ITEMS && pieces.length <= open) {
        parts = pieces;
        break;
      }
    }
  }
  while (parts.length > 0 && parts.at(-1) === "") parts.pop();
  return parts;
}
