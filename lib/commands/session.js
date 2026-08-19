import { getSubjectsCached } from "../subjectCache.js";
import { subjectView } from "../subject.js";
import { loadGrades, loadSitting, openItems } from "../queueOrder.js";
import {
  promptFor,
  ANSWER_CONVENTION,
  DRIVER_NOTE,
  ASK_READING,
} from "../present.js";
import { serveNewBatch } from "./queue.js";
import { gradeAnswer, verdictLines } from "./grade.js";
import { nextInBatch } from "./prompts.js";
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
export async function askCommand(client, { limit } = {}) {
  const open = await openItems();

  if (open?.length) {
    const waiting = open[0];
    const prompt = await promptForItem(client, waiting);
    if (!prompt) {
      console.log(
        `! item ${waiting.subjectId} has no glyph and no image — skip it.`,
      );
      return;
    }
    console.log(prompt);
    // Mid-question: they've given the meaning and the item is still holding
    // out for the reading. Printing the prompt alone would read as a fresh
    // ask, and be answered with a meaning that's already on the record.
    if (waiting.awaiting === "reading") console.log(ASK_READING);
    return;
  }

  // Nothing open. Either a finished batch is sitting there unsent — which
  // `serveNewBatch` would refuse to fetch past, rightly — or there is no
  // batch at all and it's time for one.
  if (await hasSettledGrades()) {
    const payload = await submitBatch(client);
    if (payload?.summaryLine) console.log(payload.summaryLine);
    // The summary is the session's; what to call next is the driver's, and
    // driver-facing text on stdout is text that gets read out to the user.
    console.error("Submitted. `ask` again serves the next batch — after they've said to carry on.");
    return;
  }

  const { queue, startOfSitting } = await serveNewBatch(client, { limit });
  if (queue.length === 0) {
    console.log("Nothing due right now.");
    return;
  }

  if (startOfSitting) console.log(`${ANSWER_CONVENTION}\n`);
  console.log(promptFor(queue[0], 1));
  console.error(DRIVER_NOTE);
}

/**
 * One reply, graded against whatever is open, with the verdict and the next
 * question printed under it.
 */
export async function answerCommand(client, { reply, forgive } = {}) {
  if (forgive) return forgiveLast(client, forgive);

  const open = await openItems();
  if (!open) {
    console.log(
      "! No batch on record — run `ask` to start one. This answer wasn't graded.",
    );
    return;
  }
  if (open.length === 0) {
    console.log(
      "! That batch is answered — nothing was graded against this reply.",
    );
    console.log(BATCH_ANSWERED);
    return;
  }

  const verdict = await gradeAnswer(client, {
    subjectId: open[0].subjectId,
    answer: reply,
  });
  const next = verdict.open ? null : await nextInBatch(client);
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
  if (closesBatch) console.log(BATCH_ANSWERED);
}

export const BATCH_ANSWERED =
  "(that's the batch — `ask` submits it and prints the summary; `answer --forgive meaning|reading` first " +
  "if that last verdict was a typo)";

/** The prompt for one open item, by the position it was served at. */
async function promptForItem(client, item) {
  const subjects = await getSubjectsCached(client, [item.subjectId]);
  const subject = subjects.get(item.subjectId);
  return subject ? promptFor(subjectView(subject), item.position) : null;
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
  const verdict = await gradeAnswer(client, {
    subjectId: target.subjectId,
    forgive: part,
  });
  for (const line of verdictLines(verdict)) console.log(line);
}

/** The furthest-along item this batch has finished with. */
async function lastSettled() {
  const order = await loadSitting();
  const served = order?.served;
  if (!Array.isArray(served)) return null;

  const grades = order.grades ?? {};
  const subjectIds = new Map(
    order.items.map((item) => [item.assignmentId, item.subjectId]),
  );
  for (let index = served.length - 1; index >= 0; index -= 1) {
    const assignmentId = served[index];
    const grade = grades[assignmentId];
    if (grade && !grade.awaiting && subjectIds.has(assignmentId)) {
      return {
        assignmentId,
        subjectId: subjectIds.get(assignmentId),
        position: index + 1,
      };
    }
  }
  return null;
}
