import { getSubjectsCached } from "../subjectCache.js";
import { subjectView } from "../subject.js";
import { requiresReading } from "../grading.js";
import { promptFor, criticalNote } from "../present.js";
import { fetchCritical, saveCritical, CRITICAL_THRESHOLD } from "../critical.js";

export const nothingCritical = (under) =>
  `Nothing in critical condition — WaniKani has every item you've been quizzed on at ${under}% or better.`;

/**
 * The critical-condition list, as questions — the same shape `queue` and
 * `drill` hand over, and for the same reasons.
 *
 * wanikani.com has a page for these: every item its records have you under
 * 75% correct on, worst first. It's the list people go to the website *for*
 * mid-session, and it's the one list this tool couldn't produce — `drill`
 * only knows the misses it watched happen, which on a fresh install is none
 * of them and never includes anything reviewed on the website.
 *
 * Nothing here is due and nothing here submits, exactly like `drill`: these
 * are picked by how badly they've gone historically, not by the SRS clock,
 * and answering one early would be answering it out of turn. `grade` still
 * grades it — same answer key, same verdict lines — and says it isn't
 * recording.
 */
export async function criticalCommand(client, { limit = 10, under = CRITICAL_THRESHOLD } = {}) {
  const critical = await fetchCritical(client, { under });
  // Filed before the early return as well as after it: an empty list has to
  // clear the last one, or an item that has since climbed back over the line
  // goes on grading as a drill for as long as the file sits there.
  await saveCritical(critical);

  if (critical.length === 0) {
    console.log(nothingCritical(under));
    return;
  }

  const batch = critical.slice(0, limit);
  const subjects = await getSubjectsCached(client, [...new Set(batch.map((item) => item.subjectId))]);
  // Resolved first, numbered second. A subject the API didn't hand back is
  // dropped, and numbering before the drop leaves the list reading 1, 2, 4 —
  // which looks like a question went missing off the screen rather than one
  // never having been asked.
  const items = batch
    .map((item) => {
      const subject = subjects.get(item.subjectId);
      return subject ? { ...item, view: subjectView(subject), object: subject.object } : null;
    })
    .filter(Boolean);

  const payload = items.map((item, index) => ({
    subjectId: item.subjectId,
    subjectType: item.view.subjectType,
    level: item.view.level,
    needsReading: requiresReading(item.object),
    prompt: promptFor(item.view, index + 1),
    percentageCorrect: item.percentageCorrect,
    // On the first item that survived, not the first one fetched: the note
    // carries the terms of the whole list, and a list with no terms on it is
    // a list somebody grades and tries to submit.
    ...(index === 0
      ? { critical: criticalNote({ total: critical.length, shown: items.length, under }) }
      : {}),
  }));

  console.log(JSON.stringify(payload, null, 2));
}
