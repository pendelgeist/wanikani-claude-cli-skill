import { requiresReading, primaryMeaning, primaryReading } from "./grading.js";
import { getSubjectsCached } from "./subjectCache.js";

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
  let assignments = await client.getAssignments({ immediately_available_for_review: true });
  assignments = shuffle(assignments);
  if (limit) assignments = assignments.slice(0, limit);

  // Fetch subjects only for the (already-limited) batch — cheap even on a
  // cold cache, and keeps a `--limit 10` call fast regardless of how many
  // hundred reviews are due overall.
  const subjectIds = [...new Set(assignments.map((a) => a.data.subject_id))];
  const subjects = await getSubjectsCached(client, subjectIds);

  return assignments
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
}
