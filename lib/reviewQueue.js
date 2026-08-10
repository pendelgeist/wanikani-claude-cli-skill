import { requiresReading, primaryMeaning, primaryReading } from "./grading.js";
import { getSubjectsCached } from "./subjectCache.js";
import { loadQueueOrder, saveQueueOrder, dropFromQueueOrder } from "./queueOrder.js";

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Some radicals have no Unicode glyph and rely on a custom image instead
// (WaniKani's `character_images` on the subject). Pick a PNG over an SVG —
// easier for a chat client to render inline — preferring one without a
// color override so it renders sanely on either light or dark background.
export function pickCharacterImage(characterImages) {
  if (!characterImages || characterImages.length === 0) return null;
  const pngs = characterImages.filter((img) => img.content_type === "image/png");
  const plain = pngs.find((img) => !img.metadata?.color);
  return (plain ?? pngs[0] ?? characterImages[0]).url;
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
        subjectId: subject.id,
        subjectType: subject.object,
        level: subject.data.level,
        characters: subject.data.characters,
        characterImageUrl:
          subject.data.characters == null
            ? pickCharacterImage(subject.data.character_images)
            : null,
        documentUrl: subject.data.document_url,
        primaryMeaning: primaryMeaning(subject.data),
        primaryReading: subject.object !== "radical" ? primaryReading(subject.data) : null,
        needsReading: requiresReading(subject.object),
        subject: subject.data,
      };
    })
    .filter(Boolean);
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
