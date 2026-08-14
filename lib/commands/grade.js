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
import { loadSitting, recordGrade, forgiveGrade } from "../queueOrder.js";

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
export async function gradeCommand(client, { subjectId, answer, meaning, reading, forgive, json = false }) {
  const { assignmentId, warning } = await placeInSitting(subjectId);
  const show = (verdict) => report({ ...verdict, warning }, json);

  if (forgive) {
    const recorded = await forgiveGrade(assignmentId, forgive);
    return show({ subjectId, assignmentId, forgave: forgive, recorded });
  }

  const subjects = await getSubjectsCached(client, [subjectId]);
  const subject = subjects.get(subjectId);
  if (!subject) {
    // Same shape as a verdict so the caller has one thing to read, and the
    // same exit status as `explain`'s miss: nothing broke, nothing matched.
    return show({ subjectId, error: `No subject ${subjectId} — pass the subjectId from the queue.` });
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
    return settle(show, {
      ...verdict,
      wrongMeaning: 1,
      wrongReading: readingAlsoMissed ? 1 : 0,
      say: readingAlsoMissed ? corrections.both : corrections.meaning,
      open: false,
    });
  }

  if (readingStatus === "other-reading") {
    // Not a miss: the website shakes, names the type it wants, and waits.
    return settle(show, {
      ...verdict,
      wrongMeaning: 0,
      wrongReading: 0,
      say: readingNudgeFor(wantedReadingType(data)),
      open: true,
    });
  }

  if (needsReading && !given.reading) {
    return settle(show, { ...verdict, wrongMeaning: 0, wrongReading: 0, say: ASK_READING, open: true });
  }

  if (readingStatus === "incorrect") {
    return settle(show, { ...verdict, wrongMeaning: 0, wrongReading: 1, say: corrections.reading, open: false });
  }

  return settle(show, { ...verdict, wrongMeaning: 0, wrongReading: 0, say: null, open: false });
}

/**
 * Where this subject sits in the sitting — and, when it doesn't, why not.
 * An unrecorded answer used to show up as a quiet `assignmentId: null` in the
 * middle of a JSON blob; five of them in a row went unnoticed until
 * `submit-batch` had nothing to submit.
 */
async function placeInSitting(subjectId) {
  // The sitting's age is the fetcher's business, not the recorder's: an
  // assignment that's still in the list is still the one being answered.
  const order = await loadSitting();
  if (!order) {
    return {
      assignmentId: null,
      warning:
        "NOT RECORDED — no sitting on disk (run `queue` to start one). " +
        "This answer is graded but `submit-batch` won't see it.",
    };
  }

  const item = order.items.find((entry) => entry.subjectId === subjectId);
  if (!item) {
    return {
      assignmentId: null,
      warning: `NOT RECORDED — subject ${subjectId} isn't in the current batch, so \`submit-batch\` won't see it.`,
    };
  }

  return { assignmentId: item.assignmentId, warning: null };
}

/**
 * Plain text by default, because the thing to do with `say` is print it, and
 * a line sitting alone on stdout gets copied where the same line inside a
 * fifteen-line JSON blob gets summarised — into romaji, every time. `--json`
 * is there for anything that wants the whole verdict.
 */
function report(verdict, json) {
  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
    return;
  }

  if (verdict.error) console.log(`! ${verdict.error}`);
  else if (verdict.forgave) console.log(`✓ forgiven (${verdict.forgave})`);
  else if (verdict.say) console.log(verdict.open ? verdict.say : `✗ ${verdict.say}`);
  else console.log("✓");

  if (verdict.open) console.log("(same item — still their turn)");
  if (verdict.warning) console.log(`! ${verdict.warning}`);
}

/** Reports the verdict and puts its misses on the record in one step. */
async function settle(show, verdict) {
  const recorded = verdict.assignmentId ? await recordGrade(verdict.assignmentId, verdict) : null;
  show({ ...verdict, recorded });
}
