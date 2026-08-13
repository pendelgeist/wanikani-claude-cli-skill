import { getSubjectsCached, loadSubjectCache } from "../subjectCache.js";
import { primaryMeaning } from "../grading.js";
import { subjectView, teachingView } from "../subject.js";
import { explainBlock } from "../present.js";

/**
 * The item-info screen, on demand: everything WaniKani teaches about one
 * subject, for the moment mid-review when "I know I missed that, but why is it
 * しん?" is worth thirty seconds. Never run unasked — see SKILL.md.
 *
 * Takes a subject id (what `queue` hands over) or the characters themselves
 * (what a human types). Characters can be ambiguous — 親 is a kanji *and* a
 * word — so that path explains every subject that matches rather than picking.
 */
async function resolveSubjects(client, target) {
  if (/^\d+$/.test(target)) {
    const id = Number(target);
    const subjects = await getSubjectsCached(client, [id]);
    const subject = subjects.get(id);
    return subject ? [subject] : [];
  }

  // The session's own batch is already cached, so the common case — asking
  // about the item just answered — costs no API call at all.
  const cache = await loadSubjectCache();
  const cached = [...cache.subjects.values()].filter((subject) => subject?.data?.characters === target);
  if (cached.length > 0) return cached;

  return client.getSubjectsBySlugs([target]);
}

async function componentsOf(client, subject) {
  const ids = subject.data.component_subject_ids ?? [];
  if (ids.length === 0) return [];

  const subjects = await getSubjectsCached(client, ids);
  return ids
    .map((id) => subjects.get(id))
    .filter(Boolean)
    .map((component) => ({
      characters: component.data.characters,
      meaning: primaryMeaning(component.data),
    }));
}

function explainPayload(subject, components) {
  return {
    ...subjectView(subject),
    ...teachingView(subject),
    partsOfSpeech: subject.data.parts_of_speech ?? [],
    components,
    contextSentences: subject.data.context_sentences ?? [],
  };
}

export async function explainCommand(client, { target, json = false } = {}) {
  const subjects = await resolveSubjects(client, target);

  if (subjects.length === 0) {
    console.log(
      `Nothing found for "${target}" — pass the subjectId from the queue, ` +
        `or the characters exactly as WaniKani writes them.`,
    );
    return;
  }

  const payloads = [];
  for (const subject of subjects) {
    payloads.push(explainPayload(subject, await componentsOf(client, subject)));
  }

  if (json) {
    console.log(JSON.stringify(payloads, null, 2));
    return;
  }

  console.log(payloads.map(explainBlock).join("\n\n"));
}
