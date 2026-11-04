import { requiresReading, primaryMeaning, primaryReading } from "./grading.js";
import { subjectView, withWorkingImage } from "./subject.js";
import { getSubjectsCached, loadSubjectCache } from "./subjectCache.js";
import { loadQueueOrder, resumableSitting, saveQueueOrder, dropFromQueueOrder } from "./queueOrder.js";

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Everything currently due, shuffled the way WaniKani's own review session
 * shuffles by default — fetched live once and then cached for the session.
 * Batches after the first slice from that cached order instead of re-fetching
 * every due assignment each time, which also stops consecutive batches from
 * overlapping (the same item twice in one sitting is confusing, and easy to
 * answer twice by accident).
 */
async function pendingAssignments(client) {
  const order = await loadQueueOrder();
  if (order && order.items.length > 0) return order.items;

  const assignments = await client.getAssignments({ immediately_available_for_review: true });
  const items = shuffle(
    assignments.map((assignment) => ({
      assignmentId: assignment.id,
      subjectId: assignment.data.subject_id,
    })),
  );
  // Two ways a fetch continues a sitting rather than starting one, and neither
  // of them should reset the counter the user is watching. `order` is the
  // sitting that simply ran out of fetched items: it reported "79 done this
  // sitting, 56 perfect", cleared its list, pulled the reviews that had come
  // due since, and called the very next batch ten. `resumed` is the sitting
  // that went quiet for longer than the list's thirty-minute life — a break
  // for the next hour's reviews to unlock — and came back to a scoreboard
  // reading zero and the opening how-to printed at it a second time.
  //
  // What each carries differs, and see `resumedFrom` for why. A sitting older
  // than that really does start from nothing.
  const resumed = order ? null : await resumableSitting();
  const previous = order ?? resumed;
  await saveQueueOrder(items, {
    ...(order ? carriedOver(order) : resumed ? resumedFrom(resumed) : {}),
    newlyDue: previous ? countUnseen(items, previous.items) : 0,
  });
  return items;
}

/** How many of the freshly fetched assignments the sitting hadn't already got. */
function countUnseen(items, previousItems) {
  const seen = new Set((previousItems ?? []).map((item) => item.assignmentId));
  return items.filter((item) => !seen.has(item.assignmentId)).length;
}

/**
 * What survives refetching the list mid-sitting: the totals on screen, the
 * misses carried from earlier in the sitting, and whether rapid fire has been
 * offered. `grades` deliberately doesn't — those belong to items that have
 * just been submitted and dropped, and an unsubmitted one would still be in
 * `items`, which is the branch above.
 */
const carriedOver = (order) => ({
  totals: order.totals,
  priorGrades: order.priorGrades,
  toldRapid: order.toldRapid,
});

/**
 * What survives a *break* rather than a refetch: the scoreboard and the
 * rapid-fire flag, and deliberately not a miss waiting to be submitted.
 *
 * The narrower set is the same caution `beginBatch` takes about `grades`. A
 * `priorGrades` entry is a miss on an item that was asked, missed, and asked
 * again without ever being sent — and once half an hour has gone by with the
 * user elsewhere, the next attempt at it is a fresh one, not the second half
 * of the first. An abandoned record submitted an hour later against a batch
 * the user had just answered correctly is how four items were demoted once
 * already; this is that record's smaller cousin.
 *
 * The totals carry because they are about the sitting and not about any item:
 * counting what the user did before their coffee is not a claim about how
 * well they did it.
 */
const resumedFrom = (order) => ({
  totals: order.totals,
  toldRapid: order.toldRapid,
});

/**
 * Fetches assignments currently due for review, joined with their subject data.
 * Returns a flat, quiz-ready list.
 */
export async function getReviewQueue(client, { limit } = {}) {
  const pending = await pendingAssignments(client);
  const batch = limit ? pending.slice(0, limit) : pending;

  // Fetch subjects only for the (already-limited) batch — cheap even on a
  // cold cache, and keeps a `--limit 10` call fast regardless of how many
  // hundred reviews are due overall.
  const subjects = await getSubjectsCached(client, [...new Set(batch.map((item) => item.subjectId))]);

  const items = await Promise.all(
    batch.map(async ({ assignmentId, subjectId }) => {
      const subject = subjects.get(subjectId);
      if (!subject) return null;
      return {
        assignmentId,
        ...(await withWorkingImage(subjectView(subject), subject)),
        primaryMeaning: primaryMeaning(subject.data),
        primaryReading: subject.object !== "radical" ? primaryReading(subject.data) : null,
        needsReading: requiresReading(subject.object),
        subject: subject.data,
      };
    }),
  );
  return items.filter(Boolean);
}

/**
 * Characters for the given assignments, resolved from the queue order and the
 * subject cache — no API call, so a batch summary can name the items it's
 * talking about for free. Call it before pruning: a submitted assignment
 * leaves the order. Anything unresolved is simply absent from the map.
 */
export async function charactersForAssignments(assignmentIds) {
  const characters = new Map();
  try {
    const order = await loadQueueOrder();
    if (!order) return characters;

    const subjectIds = new Map(order.items.map((item) => [item.assignmentId, item.subjectId]));
    const cache = await loadSubjectCache();
    for (const assignmentId of assignmentIds) {
      const subjectId = subjectIds.get(assignmentId);
      const subject = subjectId == null ? null : cache.subjects.get(String(subjectId));
      if (subject?.data?.characters) characters.set(assignmentId, subject.data.characters);
    }
  } catch {
    // Best-effort — an unnamed highlight just falls back to counts.
  }
  return characters;
}

/** Drops submitted assignments from the session's queue order. Best-effort. */
export async function markSubmitted(assignmentIds) {
  try {
    return await dropFromQueueOrder(assignmentIds);
  } catch {
    return null;
  }
}

/**
 * How many reviews are still due — asked of the API every time — and how many
 * of them came due after the sitting's list was fetched.
 *
 * This used to be the length of that list while it had anything in it, which
 * was free and wrong. The list is fetched once and only fetched again when it
 * runs dry or the sitting goes quiet for half an hour, and every grade counts
 * as not going quiet — so in a long sitting it is hours old, and nothing that
 * came due since is in it. One sitting ended a batch on "176 left" and asked
 * `summary` one turn later, which said 436: the 260 between them had unlocked
 * while it ran, and the list had never heard of them.
 *
 * `newlyDue` is how many of the live count the sitting's list doesn't hold —
 * the reason the number went up rather than down, when it does. `unfetched`
 * is the case where that's all of them: the list has emptied, so everything
 * still due arrived after it. With no live sitting there is no fetch to have
 * come due since, so neither claim is made.
 *
 * If the API can't be reached, the list is the best guess going, and better
 * than no number at all.
 */
export async function countRemainingReviews(client) {
  let order = null;
  try {
    order = await loadQueueOrder();
  } catch {
    // No record readable; the live count below doesn't need one.
  }
  try {
    const assignments = await client.getAssignments({ immediately_available_for_review: true });
    const remaining = assignments.length;
    if (!order) return { remaining, unfetched: false, newlyDue: 0 };
    const known = new Set(order.items.map((item) => item.assignmentId));
    const newlyDue = assignments.filter((assignment) => !known.has(assignment.id)).length;
    return { remaining, unfetched: remaining > 0 && newlyDue === remaining, newlyDue };
  } catch {
    if (order && order.items.length > 0) return { remaining: order.items.length, unfetched: false, newlyDue: 0 };
    return { remaining: null, unfetched: false, newlyDue: 0 };
  }
}
