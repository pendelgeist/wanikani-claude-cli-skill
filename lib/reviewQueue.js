import { requiresReading, primaryMeaning, primaryReading } from "./grading.js";
import { subjectView } from "./subject.js";
import { getSubjectsCached, loadSubjectCache } from "./subjectCache.js";
import { loadQueueOrder, saveQueueOrder, dropFromQueueOrder } from "./queueOrder.js";

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
  await saveQueueOrder(items);
  return items;
}

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
 * How many reviews are still due. Free while the session's queue order still
 * has items in it; falls back to the API once it's empty (or absent), which is
 * exactly when a live answer matters — reviews unlocked since the last fetch
 * show up there.
 */
export async function countRemainingReviews(client) {
  try {
    const order = await loadQueueOrder();
    if (order && order.items.length > 0) return order.items.length;
    const assignments = await client.getAssignments({ immediately_available_for_review: true });
    return assignments.length;
  } catch {
    return null;
  }
}
