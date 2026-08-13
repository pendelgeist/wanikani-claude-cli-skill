import { getSubjectsCached } from "../subjectCache.js";
import { subjectView } from "../subject.js";
import {
  isMeaningCorrect,
  readingVerdict,
  requiresReading,
  splitAnswer,
  wantedReadingType,
} from "../grading.js";
import { correctionsFor, readingNudgeFor, ASK_READING } from "../present.js";
import { loadQueueOrder, recordGrade, forgiveGrade } from "../queueOrder.js";

/**
 * Grades one answer and says what to do about it.
 *
 * The rules here — which half of "fur, ke" is the reading, whether "dzu" is
 * づ, whether another of the kanji's readings counts against the item, which
 * correction line to print — are all mechanical, and they were all being
 * re-derived from prose on every single answer by whoever was driving the
 * quiz. Interpretation is the right tool for "is 'labratory' close enough";
 * it is the wrong tool for a lookup table, and the 親/おや mis-grade is what
 * the wrong tool looks like.
 *
 * So: `say` is the whole response (correction, re-prompt, or the follow-up
 * question), `open` says whether the item is still waiting on them, and the
 * misses go straight onto the sitting's record for `submit-batch` to submit.
 * The caller keeps the judgment call it's actually good at, and overrides —
 * `--forgive` is how an overruled miss comes back off the record.
 */
export async function gradeCommand(client, { subjectId, answer, meaning, reading, forgive }) {
  const assignmentId = await assignmentFor(subjectId);

  if (forgive) {
    const recorded = await forgiveGrade(assignmentId, forgive);
    return print({ subjectId, assignmentId, forgave: forgive, recorded });
  }

  const subjects = await getSubjectsCached(client, [subjectId]);
  const subject = subjects.get(subjectId);
  if (!subject) {
    // Same shape as a verdict so the caller has one thing to parse, and the
    // same exit status as `explain`'s miss: nothing broke, nothing matched.
    return print({ subjectId, error: `No subject ${subjectId} — pass the subjectId from the queue.` });
  }

  const data = subject.data;
  const needsReading = requiresReading(subject.object);
  // Explicit halves win: a follow-up that answers only the reading has no
  // meaning to find, and guessing at one would grade a blank.
  const given =
    meaning === undefined && reading === undefined
      ? splitAnswer(answer, data, needsReading)
      : { meaning: meaning ?? null, reading: needsReading ? reading ?? null : null };

  const meaningStatus = given.meaning ? (isMeaningCorrect(given.meaning, data) ? "correct" : "incorrect") : null;
  const readingStatus = given.reading ? readingVerdict(given.reading, data).status : null;
  const corrections = correctionsFor(subjectView(subject));

  const verdict = { subjectId, assignmentId, parsed: given, meaning: meaningStatus, reading: readingStatus };

  if (meaningStatus === "incorrect") {
    // A missed meaning ends the item: asking for the reading separately
    // almost never changes the outcome, so reveal both and move on. Unless
    // they already gave the reading and got it right — then only the meaning
    // was missed, and only the meaning needs revealing.
    const readingAlsoMissed = needsReading && readingStatus !== "correct";
    return settle({
      ...verdict,
      wrongMeaning: 1,
      wrongReading: readingAlsoMissed ? 1 : 0,
      say: readingAlsoMissed ? corrections.both : corrections.meaning,
      open: false,
    });
  }

  if (readingStatus === "other-reading") {
    // Not a miss: the website shakes, names the type it wants, and waits.
    return settle({
      ...verdict,
      wrongMeaning: 0,
      wrongReading: 0,
      say: readingNudgeFor(wantedReadingType(data)),
      open: true,
    });
  }

  if (needsReading && !given.reading) {
    return settle({ ...verdict, wrongMeaning: 0, wrongReading: 0, say: ASK_READING, open: true });
  }

  if (readingStatus === "incorrect") {
    return settle({ ...verdict, wrongMeaning: 0, wrongReading: 1, say: corrections.reading, open: false });
  }

  return settle({ ...verdict, wrongMeaning: 0, wrongReading: 0, say: null, open: false });
}

/** The assignment this subject is being reviewed under, if it's in the queue. */
async function assignmentFor(subjectId) {
  const order = await loadQueueOrder();
  return order?.items.find((item) => item.subjectId === subjectId)?.assignmentId ?? null;
}

function print(verdict) {
  console.log(JSON.stringify(verdict, null, 2));
}

/** Prints the verdict and puts its misses on the record in one step. */
async function settle(verdict) {
  const recorded = verdict.assignmentId
    ? await recordGrade(verdict.assignmentId, verdict)
    : null;
  print({ ...verdict, recorded });
}
