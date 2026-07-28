import { requiresReading, primaryMeaning, primaryReading } from "./grading.js";

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Fetches assignments currently due for review, joined with their subject data.
 * Returns a flat, quiz-ready list — shuffled the way WaniKani's own review
 * session shuffles by default.
 */
export async function getReviewQueue(client, { limit } = {}) {
  const assignments = await client.getAssignments({ immediately_available_for_review: true });
  const subjectIds = [...new Set(assignments.map((a) => a.data.subject_id))];
  const subjects = await client.getSubjectsByIds(subjectIds);

  let items = assignments
    .map((assignment) => {
      const subject = subjects.get(assignment.data.subject_id);
      if (!subject) return null;
      return {
        assignmentId: assignment.id,
        subjectId: subject.id,
        subjectType: subject.object,
        level: subject.data.level,
        characters: subject.data.characters,
        documentUrl: subject.data.document_url,
        primaryMeaning: primaryMeaning(subject.data),
        primaryReading: subject.object !== "radical" ? primaryReading(subject.data) : null,
        needsReading: requiresReading(subject.object),
        subject: subject.data,
      };
    })
    .filter(Boolean);

  items = shuffle(items);
  if (limit) items = items.slice(0, limit);
  return items;
}
