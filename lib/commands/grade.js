import { getSubjectsCached } from "../subjectCache.js";
import { subjectView } from "../subject.js";
import {
  isMeaningCorrect,
  readingVerdict,
  requiresReading,
  splitAnswer,
  wantedReadingType,
} from "../grading.js";
import { alreadyAnsweredLine, correctionsFor, readingNudgeFor, ASK_READING } from "../present.js";
import { nextInBatch, BATCH_DONE } from "./prompts.js";
import { isRecentMiss } from "../misses.js";
import { loadSitting, recordGrade, forgiveGrade, awaitingFor, settledGrade } from "../queueOrder.js";

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
export async function gradeCommand(client, { json = false, ...options }) {
  const verdict = await gradeAnswer(client, options);
  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
    return;
  }

  // The whole message, not just the verdict: what to say about the answer,
  // then the question that follows it. See `nextInBatch`.
  const next = follows(verdict) ? await nextInBatch(client) : null;
  for (const line of verdictLines(verdict, { closesBatch: next?.done === true })) console.log(line);
  if (next?.prompt) console.log(`\n${next.prompt}`);
  else if (next?.done) console.log(BATCH_DONE);
}

/**
 * Whether this verdict leaves the batch ready to move on. An open item's own
 * prompt is still standing, and the paths that graded nothing — an error, an
 * item outside the batch, one already answered — have no claim on what comes
 * next.
 */
const follows = (verdict) =>
  !verdict.open && !verdict.error && !verdict.alreadyAnswered && Boolean(verdict.assignmentId);

/**
 * One answer, graded and recorded, with nothing printed. `grade-many` grades a
 * whole batch through this same path — the alternative was a second
 * implementation of "which half is this, and does it count against them",
 * which is exactly the thing this file exists to have only one of.
 */
export async function gradeAnswer(client, { subjectId, answer, meaning, reading, forgive }) {
  const { assignmentId, warning, drill } = await placeInSitting(subjectId);

  if (forgive) {
    const recorded = await forgiveGrade(assignmentId, forgive);
    return { subjectId, assignmentId, forgave: forgive, recorded, warning, drill };
  }

  const settled = assignmentId ? await settledGrade(assignmentId) : null;

  const subjects = await getSubjectsCached(client, [subjectId]);
  const subject = subjects.get(subjectId);
  if (!subject) {
    // Same shape as a verdict so the caller has one thing to read, and the
    // same exit status as `explain`'s miss: nothing broke, nothing matched.
    return {
      subjectId,
      assignmentId,
      error: `No subject ${subjectId} — pass the subjectId from the queue.`,
      warning,
      drill,
    };
  }

  const data = subject.data;

  // An item this batch already finished with doesn't get graded again. Every
  // path to a second answer for it is a bad one: the correction revealed the
  // answer, so a re-ask is asking someone to read it back, and the attempt
  // would land on top of the record rather than replacing it — a miss plus a
  // "✓" is still a miss at `submit-batch`, which is exactly the contradiction
  // one session reported to the user six times in a row. The override exists
  // and is named here; it is the only thing that moves a settled verdict.
  if (settled) {
    return {
      subjectId,
      assignmentId,
      characters: data.characters ?? null,
      alreadyAnswered: settled,
      say: alreadyAnsweredLine({ characters: data.characters ?? null, subjectId, grade: settled }),
      open: false,
      recorded: settled,
      warning,
      drill,
    };
  }

  const needsReading = requiresReading(subject.object);
  const given = await whatTheyGave({ answer, meaning, reading, data, needsReading, assignmentId });
  const verdict = {
    subjectId,
    assignmentId,
    characters: data.characters ?? null,
    parsed: given,
    ...decide({ given, data, needsReading, subject }),
  };

  // One place where a verdict becomes a record, so no branch above can settle
  // an item and forget to.
  const recorded = assignmentId
    ? await recordGrade(assignmentId, { ...verdict, awaiting: verdict.open ? "reading" : null })
    : null;
  return { ...verdict, recorded, warning, drill };
}

/**
 * The verdict itself: what they got wrong, what to say about it, and whether
 * the item is still theirs to answer. Pure — it reads the answer key and
 * returns a judgement, and everything that writes anything lives above it.
 */
function decide({ given, data, needsReading, subject }) {
  const meaning = given.meaning ? (isMeaningCorrect(given.meaning, data) ? "correct" : "incorrect") : null;
  const reading = given.reading ? readingVerdict(given.reading, data).status : null;
  const corrections = correctionsFor(subjectView(subject));
  const verdict = { meaning, reading };

  if (meaning === "incorrect") {
    // A missed meaning ends the item: asking for the reading separately
    // almost never changes the outcome, so reveal both and move on. Unless
    // they already gave the reading and got it right — then only the meaning
    // was missed, and only the meaning needs revealing.
    const readingAlsoMissed = needsReading && reading !== "correct";
    return {
      ...verdict,
      wrongMeaning: 1,
      wrongReading: readingAlsoMissed ? 1 : 0,
      say: readingAlsoMissed ? corrections.both : corrections.meaning,
      open: false,
    };
  }

  if (reading === "other-reading") {
    // Not a miss: the website shakes, names the type it wants, and waits.
    return {
      ...verdict,
      wrongMeaning: 0,
      wrongReading: 0,
      say: readingNudgeFor(wantedReadingType(data)),
      open: true,
    };
  }

  if (needsReading && !given.reading) {
    return { ...verdict, wrongMeaning: 0, wrongReading: 0, say: ASK_READING, open: true };
  }

  if (reading === "incorrect") {
    return { ...verdict, wrongMeaning: 0, wrongReading: 1, say: corrections.reading, open: false };
  }

  return { ...verdict, wrongMeaning: 0, wrongReading: 0, say: null, open: false };
}

/**
 * Which half of the answer is in front of us.
 *
 * Explicit flags win. Otherwise the reply is split — except when the item is
 * mid-question: after "Reading?" or a re-prompt, a bare reply is the reading
 * they were just asked for, not a meaning. Reading it as a meaning turned a
 * right answer into two wrong ones, and it's the natural thing to type.
 */
async function whatTheyGave({ answer, meaning, reading, data, needsReading, assignmentId }) {
  if (meaning !== undefined || reading !== undefined) {
    return { meaning: meaning ?? null, reading: needsReading ? (reading ?? null) : null };
  }

  const split = splitAnswer(answer, data, needsReading);
  if (!needsReading || split.reading) return split;

  const outstanding = assignmentId ? await awaitingFor(assignmentId) : null;
  const whole = (answer ?? "").trim();
  return outstanding === "reading" && whole ? { meaning: null, reading: whole } : split;
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
    if (await isRecentMiss(subjectId)) return { assignmentId: null, warning: null, drill: true };
    return {
      assignmentId: null,
      warning:
        "NOT RECORDED — no sitting on disk (run `queue` to start one). " +
        "This answer is graded but `submit-batch` won't see it.",
    };
  }

  const item = order.items.find((entry) => entry.subjectId === subjectId);
  if (!item) {
    // Not being in the batch is a problem when it's a review and the whole
    // point is the record; it's the *arrangement* when it's a drill. Same
    // grading either way, different thing to say about it.
    if (await isRecentMiss(subjectId)) return { assignmentId: null, warning: null, drill: true };
    return {
      assignmentId: null,
      warning: `NOT RECORDED — subject ${subjectId} isn't in the current batch, so \`submit-batch\` won't see it.`,
    };
  }

  return { assignmentId: item.assignmentId, warning: null };
}

/**
 * The line to say, and the state of the item under it.
 *
 * Plain text by default, because the thing to do with `say` is print it, and a
 * line sitting alone on stdout gets copied where the same line inside a
 * fifteen-line JSON blob gets summarised — into romaji, every time. `--json`
 * is there for anything that wants the whole verdict.
 */
export function verdictLines(verdict, { label = "", closesBatch = false } = {}) {
  const lines = [];
  const prefix = label ? `${label} ` : "";

  if (verdict.error) lines.push(`${prefix}! ${verdict.error}`);
  // Not a verdict on this answer — there was no room for one — so it reads as
  // a problem, like the other `!` lines, rather than as a ✓ or a ✗.
  else if (verdict.alreadyAnswered) lines.push(`${prefix}! ${verdict.say}`);
  else if (verdict.forgave) lines.push(`${prefix}✓ forgiven (${verdict.forgave})`);
  else if (verdict.say) lines.push(verdict.open ? `${prefix}${verdict.say}` : `${prefix}✗ ${verdict.say}`);
  else lines.push(`${prefix}✓`);

  // Both markers name whose turn it is, because that is the question the line
  // above leaves open and the one that kept getting answered wrong. A closed
  // miss was read as an invitation to try again — "Retry?" went out after
  // nearly every wrong answer of one session, and a retry changes no score:
  // the miss is already recorded and WaniKani doesn't offer one either.
  if (verdict.open) lines.push("(same item — still their turn)");
  // "next item" when the batch has run out would be a question nobody asked;
  // the line under this one says what actually comes next.
  else if (verdict.say && !verdict.alreadyAnswered) {
    lines.push(closesBatch ? "(recorded)" : "(recorded — next item)");
  }

  if (verdict.warning) lines.push(`! ${verdict.warning}`);
  else if (verdict.drill) lines.push("(drill — nothing recorded, nothing submitted)");
  return lines;
}
