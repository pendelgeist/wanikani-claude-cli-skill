import { getReviewQueue } from "../reviewQueue.js";

/**
 * Machine-readable review queue, including the accepted meanings/readings —
 * intended for a Claude Code session to drive the quiz conversationally and
 * grade the user's spoken answers with its own judgment, then call `submit`.
 */
export async function queueCommand(client, { limit } = {}) {
  const queue = await getReviewQueue(client, { limit });
  const payload = queue.map((item) => ({
    assignmentId: item.assignmentId,
    subjectType: item.subjectType,
    level: item.level,
    characters: item.characters,
    characterImageUrl: item.characterImageUrl,
    documentUrl: item.documentUrl,
    needsReading: item.needsReading,
    meanings: item.subject.meanings,
    auxiliaryMeanings: item.subject.auxiliary_meanings,
    readings: item.subject.readings ?? [],
  }));
  console.log(JSON.stringify(payload, null, 2));
}
