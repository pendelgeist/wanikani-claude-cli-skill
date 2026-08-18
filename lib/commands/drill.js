import { getSubjectsCached } from "../subjectCache.js";
import { subjectView } from "../subject.js";
import { requiresReading } from "../grading.js";
import { promptFor, DRILL_NOTE } from "../present.js";
import { loadMisses } from "../misses.js";

export const NO_MISSES =
  "Nothing missed on record yet — misses are filed as each batch is submitted, so this fills up as you review.";

/**
 * The items answered wrong recently, as questions — the same shape `queue`
 * hands over, and for the same reason.
 *
 * "Let's re-review my recent mistakes" is a normal thing to ask and had no
 * answer here, so a session built the list out of the chat log: nineteen items
 * recalled from a transcript, quizzed and graded from memory, with the
 * corrections in romaji. Every one of those items was in the record. This is
 * the record, asked properly.
 *
 * Nothing here is due and nothing here submits. `grade` still grades it —
 * same answer key, same verdict lines — and says that it isn't recording.
 */
export async function drillCommand(client, { limit = 10 } = {}) {
  const misses = await loadMisses({ limit });
  if (misses.length === 0) {
    console.log(NO_MISSES);
    return;
  }

  const subjects = await getSubjectsCached(client, [...new Set(misses.map((miss) => miss.subjectId))]);
  const payload = misses
    .map((miss, index) => {
      const subject = subjects.get(miss.subjectId);
      if (!subject) return null;
      const view = subjectView(subject);
      return {
        subjectId: miss.subjectId,
        subjectType: view.subjectType,
        level: view.level,
        needsReading: requiresReading(subject.object),
        prompt: promptFor(view, index + 1),
        missedMeaning: miss.missedMeaning,
        missedReading: miss.missedReading,
        missedAt: miss.at,
        ...(index === 0 ? { drill: DRILL_NOTE } : {}),
      };
    })
    .filter(Boolean);

  console.log(JSON.stringify(payload, null, 2));
}
