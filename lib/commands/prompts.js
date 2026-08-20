import { getSubjectsCached } from "../subjectCache.js";
import { subjectView } from "../subject.js";
import { openItems, rapidExplained } from "../queueOrder.js";
import { promptFor, promptListFor } from "../present.js";

export const NO_BATCH =
  "No batch on the record — run `queue --limit 10` first, and this lists what's still open in it.";

/**
 * Every question in the current batch that hasn't been answered yet, as one
 * block to print.
 *
 * The whole point is that the list is built from the data rather than from
 * memory. A session that wrote its own out reached for what it knew about each
 * item and printed nine meanings and readings — the answers — as the prompt.
 * There is nothing here that isn't already in `queue`'s output; the value is
 * that it comes back as a finished string with no answers in it.
 */
export async function promptsCommand(client) {
  const open = await openItems();
  if (!open) {
    console.log(`! ${NO_BATCH}`);
    return;
  }
  if (open.length === 0) {
    console.log("Nothing open — every item in this batch is answered. Next: `submit-batch`.");
    return;
  }

  const subjects = await getSubjectsCached(client, [...new Set(open.map((item) => item.subjectId))]);
  const items = open
    .map((item) => {
      const subject = subjects.get(item.subjectId);
      return subject ? { ...subjectView(subject), position: item.position } : null;
    })
    .filter(Boolean);

  console.log(promptListFor(items, { convention: !(await rapidExplained()) }));
}

/**
 * What's left after a round of grading, named by number. Absent when nothing
 * is — a batch that's fully answered says so through `submit-batch`, not here.
 */
export function stillOpenLine(open) {
  if (open.length === 0) return null;
  const numbers = open.map((item) => item.position).join(", ");
  return `Still open: ${numbers} — still their turn (\`prompts\` re-asks what's left).`;
}

export const BATCH_DONE = "(that's the batch — `submit-batch` next)";

/**
 * What comes after the answer just graded: the next question in the batch, or
 * the fact that there isn't one. Null when there's no batch on record at all.
 *
 * It exists so that the message a session sends after grading — a verdict and
 * then the next prompt — can be *printed* rather than composed. Composing it
 * is where the verdict gets rewritten: across every transcript so far, the
 * correction line comes back paraphrased into romaji with the lookup link
 * dropped, eleven times in one sitting, once with the kana wrong. The line was
 * finished; what wasn't finished was the message around it, so now that is too.
 */
export async function nextInBatch(client) {
  const open = await openItems();
  if (!open) return null;
  if (open.length === 0) return { done: true };

  // The first open item that can actually be *shown*, not simply the first
  // one. An item with no glyph and no image has no prompt, and skipping past
  // it here is what keeps the question being asked and the answer being
  // graded on the same item: `ask` and `answer` both come through this, so
  // they cannot disagree about which item is waiting. Picking `open[0]`
  // independently in each would grade a reply against an item the user was
  // shown an error in place of.
  const subjects = await getSubjectsCached(
    client,
    open.map((entry) => entry.subjectId),
  );
  for (const entry of open) {
    const subject = subjects.get(entry.subjectId);
    const prompt = subject ? promptFor(subjectView(subject), entry.position) : null;
    if (prompt) return { item: { ...entry, characters: subject.data.characters ?? null }, prompt };
  }
  // Nothing left that can be put on screen. The items stay open and stay due:
  // an item nobody could be shown is not an item anybody can answer.
  return { unshowable: open.length };
}
