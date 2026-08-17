import { openItems } from "../queueOrder.js";
import { gradeAnswer, verdictLines } from "./grade.js";
import { NO_BATCH, stillOpenLine } from "./prompts.js";

// One divider for the list, the one the how-to line names. `grade` also
// accepts `|` *inside* an answer, which is the reason this refuses a reply
// with more parts than there are open items rather than guessing which pipes
// were boundaries: a misaligned batch grades ten right answers as ten wrong
// ones against the wrong items, and nobody would see it until submit.
const ITEM_SEPARATOR = /\s*\|\s*|\s*\n+\s*/;

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

  const replies = splitReplies(answers);
  if (replies.length > open.length) {
    console.log(
      `! ${replies.length} answers for ${open.length} open item${open.length === 1 ? "" : "s"} — nothing graded. ` +
        'Items are separated by "|", so an answer containing one splits in two; ' +
        "re-send them matching the list, or grade the odd one out on its own.",
    );
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

  const stillOpen = await openItems();
  const tail = stillOpenLine(stillOpen ?? []);
  if (tail) console.log(tail);
}

/**
 * The reply, split into one answer per item. Trailing empties are dropped
 * because a trailing "|" is how people type a list; interior ones are kept,
 * because that's someone skipping an item.
 */
export function splitReplies(raw) {
  const parts = (raw ?? "").split(ITEM_SEPARATOR).map((part) => part.trim());
  while (parts.length > 0 && parts.at(-1) === "") parts.pop();
  return parts;
}
