import { requiresReading, primaryMeaning, primaryReading } from "./grading.js";
import { subjectView } from "./subject.js";
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

  return batch
    .map(({ assignmentId, subjectId }) => {
      const subject = subjects.get(subjectId);
      if (!subject) return null;
      return {
        assignmentId,
        ...subjectView(subject),
        primaryMeaning: primaryMeaning(subject.data),
        primaryReading: subject.object !== "radical" ? primaryReading(subject.data) : null,
        needsReading: requiresReading(subject.object),
        subject: subject.data,
      };
    })
    .filter(Boolean);
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
 * How many reviews are still due, and whether that number is a fresh count
 * rather than what's left of the list this sitting fetched.
 *
 * Free while the session's queue order still has items in it; falls back to
 * the API once it's empty (or absent), which is exactly when a live answer
 * matters — reviews unlocked since the last fetch show up there.
 *
 * `unfetched` is what makes the fallback safe to print. The sitting's list is
 * *every* assignment that was due when it was fetched, so a live sitting that
 * has emptied it has submitted all of them, and whatever the API still has is
 * new since. That is the one way this number goes up rather than down between
 * two batches, and it did: a sitting closed one batch on "7 left" and the
 * next, seven items later, on "31 left". Both were right — thirty-one reviews
 * had come due while it ran — and nothing on screen said so, so the driver
 * wrote "all reviews cleared, session done" underneath a line that had just
 * counted thirty-one. `newlyDue` covers the same jump when a *fetch* is what
 * surfaces it; this covers the jump that surfaces at the submit.
 *
 * Without a live sitting there is no fetch to have come due since, so the
 * claim isn't made: a null order is one that aged out, and its unsubmitted
 * items would be counted here as if they were new.
 */
export async function countRemainingReviews(client) {
  try {
    const order = await loadQueueOrder();
    if (order && order.items.length > 0) return { remaining: order.items.length, unfetched: false };
    const assignments = await client.getAssignments({ immediately_available_for_review: true });
    return { remaining: assignments.length, unfetched: Boolean(order) };
  } catch {
    return { remaining: null, unfetched: false };
  }
}
