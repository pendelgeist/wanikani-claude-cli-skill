import { getSubjectsCached, loadSubjectCache } from "../subjectCache.js";
import { primaryMeaning, stripMnemonicMarkup } from "../grading.js";
import { pickCharacterImage } from "../reviewQueue.js";
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
  const data = subject.data;
  return {
    subjectId: subject.id,
    subjectType: subject.object,
    level: data.level,
    characters: data.characters,
    characterImageUrl: data.characters == null ? pickCharacterImage(data.character_images) : null,
    documentUrl: data.document_url,
    meanings: data.meanings,
    readings: data.readings ?? [],
    partsOfSpeech: data.parts_of_speech ?? [],
    components,
    meaningMnemonic: stripMnemonicMarkup(data.meaning_mnemonic),
    meaningHint: stripMnemonicMarkup(data.meaning_hint),
    readingMnemonic: stripMnemonicMarkup(data.reading_mnemonic),
    readingHint: stripMnemonicMarkup(data.reading_hint),
    contextSentences: data.context_sentences ?? [],
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
