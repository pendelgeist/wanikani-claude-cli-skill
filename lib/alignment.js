import { isMeaningCorrect, readingVerdict, requiresReading, splitAnswer } from "./grading.js";

/**
 * Whether a list of answers lines up with the list of questions it was typed
 * against — checked before anything is recorded.
 *
 * `grade-many` maps a one-line reply onto the open batch by position: first
 * answer to the first open item, and so on. That is right whenever the reply
 * is the batch in order, and it is silently, expensively wrong when one item
 * in the middle was passed over without leaving a gap for it. Everything from
 * the skip onwards is graded against the question before it.
 *
 * It happened. Ten items, nine answers, and the fourth item — a radical the
 * user didn't know — was left out rather than blanked:
 *
 *     4. 𠫓 (Trash)      got "used chuuko"          (中古, item 5)
 *     5. 中古            got "sipmle"               (単, item 6)
 *     6. 単 (Simple)     got "to lack something kaku" (欠く, item 7)
 *     7. 欠く            got "to become naru"       (成る, item 8)
 *     8. 成る            got "decision dettei"      (決定, item 9)
 *     9. 決定            got "become sei"           (成, item 10)
 *
 * Six items missed on answers that were right about the item one place along;
 * 中古 and 決定 were demoted a level each for it, and the tenth item's own
 * answer — the one that fell off the end — came back ✓ when it was re-asked
 * on its own a minute later. Nothing on screen suggested any of it: every
 * correction was a correct correction for the item it was printed under.
 *
 * The file's other guard refuses a reply with *more* parts than there are
 * open items for exactly this reason. A short reply can't be refused the same
 * way — answering a few and keeping the rest is a documented thing to do — so
 * this decides the other way round: grade the answer key against every
 * in-order alignment the reply admits, and if one fits materially better than
 * position-for-position, say so and record nothing.
 */

/**
 * How much of an item a reply would get right: one point for the meaning, one
 * for the reading where the item asks for one. Pure — it reads the key and
 * nothing else, which is what makes it safe to run across a hundred pairings
 * before a single one is committed.
 *
 * Another of a kanji's real readings scores, because the site re-prompts for
 * those rather than counting them wrong; an answer that lands on one is an
 * answer that found the right item.
 */
export function scoreAnswer(reply, subject) {
  if (!reply || !subject) return 0;
  const data = subject.data;
  const needsReading = requiresReading(subject.object);
  const { meaning, reading } = splitAnswer(reply, data, needsReading);

  let score = 0;
  if (meaning && isMeaningCorrect(meaning, data)) score += 1;
  if (!needsReading) return score;
  if (reading && readingVerdict(reading, data).status !== "incorrect") score += 1;
  return score;
}

/**
 * The best in-order pairing of `replies` onto `subjects`, and the one
 * `grade-many` would actually use.
 *
 * Answers keep their order — somebody typing a list types it top to bottom —
 * so the only freedom is which questions got skipped. That makes it the
 * ordinary edit-distance table: `dp[i][j]` is the best score for the first i
 * answers against the first j items, either leaving item j unanswered or
 * spending answer i on it.
 *
 * `positions` comes back as the item index each answer landed on, so the
 * message can name the first one that moved.
 */
function bestAlignment(replies, subjects) {
  const n = replies.length;
  const m = subjects.length;
  const score = replies.map((reply) => subjects.map((subject) => scoreAnswer(reply, subject)));

  const NONE = Number.NEGATIVE_INFINITY;
  // dp[i][j], with i answers spent against the first j items.
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(NONE));
  const from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  for (let j = 0; j <= m; j += 1) dp[0][j] = 0;

  for (let i = 1; i <= n; i += 1) {
    for (let j = i; j <= m; j += 1) {
      const skipItem = dp[i][j - 1];
      const useItem = dp[i - 1][j - 1] === NONE ? NONE : dp[i - 1][j - 1] + score[i - 1][j - 1];
      if (useItem >= skipItem) {
        dp[i][j] = useItem;
        from[i][j] = "use";
      } else {
        dp[i][j] = skipItem;
        from[i][j] = "skip";
      }
    }
  }

  const positions = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (from[i][j] === "use") {
      positions[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else {
      j -= 1;
    }
  }

  return { score: dp[n][m], positions };
}

/**
 * How much better a shifted reading of the reply has to be before this refuses
 * to grade the straight one.
 *
 * Two points is one whole item — both halves of a question that the straight
 * pairing missed and a shifted one gets right. Below that the evidence is a
 * coincidence: an answer that happens to be near some other item in the batch,
 * which costs nothing to grade as typed. At or above it, the reply is
 * answering questions it wasn't printed under.
 */
const MISALIGNMENT_MARGIN = 2;

/**
 * Whether the reply looks like it skipped an item rather than stopping short,
 * and where. Null when position-for-position is as good as anything else —
 * which is always the case when the reply answers every open item, since then
 * there is nothing to shift.
 */
export function findMisalignment(replies, subjects) {
  const answered = replies.filter(Boolean).length;
  if (answered === 0 || replies.length >= subjects.length) return null;

  const straight = replies.reduce((total, reply, index) => total + scoreAnswer(reply, subjects[index]), 0);
  const best = bestAlignment(replies, subjects);
  if (best.score - straight < MISALIGNMENT_MARGIN) return null;

  // The first answer the better reading puts somewhere else — which is the
  // one just past the skip, and the only one worth naming. Everything after
  // it moved for the same reason.
  //
  // An empty slot is skipped over here: it scores nothing wherever it lands,
  // so the alignment is free to put it anywhere, and naming answer 3 ("") as
  // the evidence would point at the one part of the reply that is already
  // doing the right thing.
  const moved = best.positions.findIndex(
    (position, index) => Boolean(replies[index]) && position !== null && position !== index,
  );
  if (moved === -1) return null;

  return { answerIndex: moved, fitsIndex: best.positions[moved], gain: best.score - straight };
}
