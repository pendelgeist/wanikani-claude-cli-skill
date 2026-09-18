import { loadGrades, loadSitting, openItems } from "../queueOrder.js";
import { ANSWER_CONVENTION, CARRY_ON, DRIVER_NOTE, ASK_READING, newlyDueLine } from "../present.js";
import { serveNewBatch } from "./queue.js";
import { follows, gradeAnswer, verdictLines } from "./grade.js";
import { nextInBatch, openPromptList } from "./prompts.js";
import { submitBatch } from "./submitBatch.js";

/**
 * The whole review loop as two commands, so that driving it takes no
 * decisions.
 *
 * `queue`, `grade`, `prompts` and `submit-batch` are still the primitives, and
 * everything here is a thin arrangement of them. What this pair removes is the
 * bookkeeping a session had to do between them: which of ten subject ids the
 * reply belongs to, whether the batch is exhausted, whether it's time to
 * submit, where to find the first prompt inside a JSON payload. Every one of
 * those is derivable from the record on disk — and every one of them has been
 * got wrong in a real sitting, because a driver holding ten ids and a batch
 * counter is a driver with ten chances to pick the wrong one.
 *
 * So: `ask` prints the question that's waiting, and `answer` grades whatever
 * is open. Neither takes an id. Between them there is nothing left to decide
 * and, deliberately, nothing left to say — both print the finished text
 * themselves.
 */

/**
 * The question that's waiting, printed. Fetches a batch when there isn't one,
 * re-asks the open item when there is, and submits a finished batch before
 * going anywhere near the next one.
 */
/**
 * How many items a batch is when nobody says. `queue` takes whatever it's
 * given and the old flow always said `--limit 10`; `ask` replaced that call
 * and didn't carry the number over, so one sitting was served all 67 reviews
 * that were due as a single batch. A batch only submits once every item in it
 * is answered, so ten answers sat unsent behind fifty-seven unasked ones, and
 * would have gone with the sitting when it timed out.
 */
const DEFAULT_BATCH = 10;

export async function askCommand(client, { limit = DEFAULT_BATCH, all = false } = {}) {
  if (await showWaiting(client, { all })) return;

  // Nothing waiting. Either a finished batch is sitting there unsent — which
  // `serveNewBatch` would refuse to fetch past, rightly — or there is no
  // batch at all and it's time for one.
  if (await hasSettledGrades()) {
    const payload = await submitBatch(client);
    if (payload?.summaryLine) console.log(payload.summaryLine);
    // The beat where the batch ends is where prose gets written. One sitting
    // closed eight consecutive batches with eight different questions of its
    // own — "Continue?", "Stop?", "Stop wanikani?", "Done for today?" — to a
    // user who answered "continue" or "next" every single time, and signed
    // off the sitting with "(61% accuracy)", a figure nobody printed and
    // which isn't what `perfect` counts anyway. So the line that hands the
    // turn back is issued here rather than described in SKILL.md, for the
    // same reason as every other finished string in this CLI: what isn't
    // printed gets composed.
    if ((payload?.remaining ?? 0) > 0) console.log(CARRY_ON);
    // The summary is the session's; what to call next is the driver's, and
    // driver-facing text on stdout is text that gets read out to the user.
    console.error("Submitted. `ask` again serves the next batch — after they've said to carry on.");
    return;
  }

  const { queue, startOfSitting, newlyDue } = await serveNewBatch(client, { limit });
  if (queue.length === 0) {
    console.log("Nothing due right now.");
    return;
  }

  // Through the same resolver, not `queue[0]`: the first question of a batch
  // is chosen exactly the way every later one is. Reaching into the fresh
  // payload here printed a literal "null" when the shuffle put an item with
  // no glyph and no image at position one, and picked that item while
  // `answer` was picking a different one.
  const shown = await showWaiting(client, { all });

  // The notes go *under* the question, never over it. Claude Code shows the
  // first lines of a command's output and folds the rest behind "+2 lines",
  // so whatever `ask` prints first is the part that reaches the screen —
  // and for the whole life of this flow that was two notes, with the
  // question itself in the fold. Two sittings in one day opened that way;
  // the first item of the first one was answered by someone who had never
  // seen it, with the answer to a different item, and went down as a miss.
  // The same reasoning already moved the driver note off every batch (see
  // present.js); it applies just as much to the order within one call.
  // `--all` has already printed the rapid-fire how-to under its list, and the
  // two conventions say the same thing twice over a batch of ten.
  const notes = [newlyDue > 0 && newlyDueLine(newlyDue), startOfSitting && !all && ANSWER_CONVENTION].filter(Boolean);
  if (notes.length > 0) console.log(`${shown ? "\n" : ""}${notes.join("\n")}`);
  if (startOfSitting) console.error(DRIVER_NOTE);
}

/**
 * Prints the question that's waiting, if there is one. False means there
 * isn't: the batch is answered, or there is no batch.
 *
 * `all` prints every open question instead of the first — the whole batch, in
 * one block, for a reply that answers them all at once. It is the same list
 * `prompts` prints, and it is here because the rapid-fire path used to need
 * both calls: `ask` for the batch and `prompts` for the list, which is one
 * round trip per batch to print question one twice.
 */
async function showWaiting(client, { all = false } = {}) {
  if (all) {
    const open = (await openItems()) ?? [];
    if (open.length > 0) {
      console.log(await openPromptList(client, open));
      return true;
    }
    return false;
  }

  const waiting = await nextInBatch(client);

  if (waiting?.prompt) {
    console.log(waiting.prompt);
    // Mid-question: they've given the meaning and the item is still holding
    // out for the reading. Printing the prompt alone would read as a fresh
    // ask, and be answered with a meaning that's already on the record.
    if (waiting.item.awaiting === "reading") console.log(ASK_READING);
    return true;
  }

  if (waiting?.unshowable) {
    console.log(
      `! ${waiting.unshowable} item${waiting.unshowable === 1 ? "" : "s"} left in this batch and no way to ` +
        "show any of them — no glyph and no image. Nothing has been graded against them and they stay due; " +
        "stopping here costs nothing.",
    );
    return true;
  }

  return false;
}

/**
 * One reply, graded against whatever is open, with the verdict and the next
 * question printed under it.
 */
export async function answerCommand(client, { reply, forgive } = {}) {
  if (forgive) return forgiveLast(client, forgive);

  // The same resolver `ask` printed from, so the item being graded is the item
  // they were shown — not merely the first one open.
  const waiting = await nextInBatch(client);
  if (!waiting) {
    console.log("! No batch on record — run `ask` to start one. This answer wasn't graded.");
    return;
  }
  if (waiting.done) {
    console.log("! That batch is answered — nothing was graded against this reply.");
    // No verdict of its own to overrule, so no `--forgive` offer: the reply
    // that could have been a typo was graded some time before this one.
    console.log(batchAnswered());
    return;
  }
  if (waiting.unshowable) {
    console.log("! Nothing in this batch can be shown, so there was no question to answer. Nothing was graded.");
    return;
  }

  const asked = kanjiIn(reply);
  if (asked) {
    // Name what *they* mentioned, which isn't always the open item — someone
    // mid-batch on 交ぜる asking about 場 wants `explain 場`.
    const open = waiting.item.characters;
    console.log(`! That reads as a question rather than an answer, so nothing was graded${open ? ` — ${open} is still open` : ""}.`);
    console.log(`\`explain ${asked}\` for what WaniKani teaches about it; \`tips\` for what else you can say.`);
    return;
  }

  const verdict = await gradeAnswer(client, { subjectId: waiting.item.subjectId, answer: reply });
  // `follows` and not just `!open`: an item whose answer went nowhere — an
  // error, a subject that isn't in the batch, a `NOT RECORDED` warning — has
  // no claim on what comes next, and printing the next question under one
  // sweeps the warning off the screen along with the answer it lost.
  const next = follows(verdict) ? await nextInBatch(client) : null;
  const closesBatch = next?.done === true;

  for (const line of verdictLines(verdict, { closesBatch })) console.log(line);
  if (next?.prompt) {
    console.log(`\n${next.prompt}`);
    return;
  }
  // The batch is answered. It is *not* submitted here, though submitting is
  // the only thing left that can happen to it: a miss on the last item has to
  // stay overrulable, and `--forgive` cannot reach a verdict that has already
  // gone to the API. `ask` submits it on the way to the next batch, so the
  // decision still isn't anyone's — it just waits a beat.
  if (closesBatch) console.log(batchAnswered(missesIn(verdict)));
}

/** Which halves the verdict just printed went down as wrong, if either. */
const missesIn = (verdict) =>
  [verdict.wrongMeaning > 0 && "meaning", verdict.wrongReading > 0 && "reading"].filter(Boolean);

/**
 * The kanji in a reply, if any — and an answer never has one.
 *
 * Meanings are English and readings are kana, so the only reason to type a
 * kanji into a review is to *ask about one* — "tip 育", "explain 場", "what
 * was 追 again". One of those went in as an answer verbatim, exactly as the
 * hand-over rule says it should, and 育 went down as a miss on both halves
 * because the user wanted a hint.
 *
 * Han script rather than a BMP range, so the rarer radicals count too — 𦰩
 * lives outside it. Kana alone is untouched: answering a reading in kana is
 * the whole point.
 *
 * The *word* it hands back takes the kana around that kanji with it, though.
 * Matching the bare Han run turned "tip 心強い" into a suggestion to
 * `explain 心強`, which is not an item and would have come back empty — and
 * the queue's shuffle meant that only showed up in one test run out of four.
 */
const JAPANESE_RUN =
  /[\p{Script=Hiragana}\p{Script=Katakana}ー々]*\p{Script=Han}[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]*/u;

const kanjiIn = (reply) => (reply ?? "").match(JAPANESE_RUN)?.[0] ?? null;

/**
 * The end of a batch: what happens next, and the override for the answer that
 * just closed it — but only when there is something to override.
 *
 * The offer used to ride every batch, `meaning|reading` and all, and five
 * batches out of seven in one sitting ended on a correct answer with an
 * invitation to forgive it underneath. An offer that is on screen whether or
 * not it applies is read as boilerplate, and boilerplate is what the offer
 * was moved out of `SKILL.md` to stop being: it went unused for six sittings
 * there, past several plain typos. So it appears when the last verdict was a
 * miss, and names the half that was missed rather than both.
 */
export function batchAnswered(missed = []) {
  const undo = missed.length
    ? `; \`answer --forgive ${missed.join("|")}\` first if that was a typo`
    : "";
  return `(that's the batch — \`ask\` submits it and prints the summary${undo})`;
}

const hasSettledGrades = async () => Object.values(await loadGrades()).some((grade) => !grade.awaiting);

/**
 * Takes the last settled miss back off the record — the override, for a typo
 * the answer key called wrong. It needs no id for the same reason `answer`
 * doesn't: the item it means is the one just graded, and the record knows
 * which that is.
 */
async function forgiveLast(client, part) {
  const target = await lastSettled();
  if (!target) {
    console.log("! Nothing to forgive — no settled item in this batch.");
    return;
  }
  const verdict = await gradeAnswer(client, { subjectId: target.subjectId, forgive: part });
  for (const line of verdictLines(verdict)) console.log(line);
}

/** The furthest-along item this batch has finished with. */
async function lastSettled() {
  const order = await loadSitting();
  const served = order?.served;
  if (!Array.isArray(served)) return null;

  const grades = order.grades ?? {};
  const subjectIds = new Map(order.items.map((item) => [item.assignmentId, item.subjectId]));
  for (let index = served.length - 1; index >= 0; index -= 1) {
    const assignmentId = served[index];
    const grade = grades[assignmentId];
    if (grade && !grade.awaiting && subjectIds.has(assignmentId)) {
      return { assignmentId, subjectId: subjectIds.get(assignmentId), position: index + 1 };
    }
  }
  return null;
}
