import * as wanakana from "wanakana";

/** Subject types that only quiz meaning (no reading part). */
const MEANING_ONLY_TYPES = new Set(["radical", "kana_vocabulary"]);

export function requiresReading(subjectType) {
  return !MEANING_ONLY_TYPES.has(subjectType);
}

function normalizeMeaning(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Converts romaji to kana (if it looks like romaji) and trims. Already-kana input passes through. */
export function normalizeReadingInput(text) {
  return wanakana.toKana(text.trim());
}

/**
 * Meaning is correct if it matches a subject meaning (or a whitelisted auxiliary
 * meaning) and does not match a blacklisted auxiliary meaning.
 */
export function isMeaningCorrect(input, subject) {
  const normalizedInput = normalizeMeaning(input);
  if (!normalizedInput) return false;

  const blacklist = (subject.auxiliary_meanings || [])
    .filter((m) => m.type === "blacklist")
    .map((m) => normalizeMeaning(m.meaning));
  if (blacklist.includes(normalizedInput)) return false;

  const accepted = [
    ...subject.meanings.filter((m) => m.accepted_answer).map((m) => m.meaning),
    ...(subject.auxiliary_meanings || [])
      .filter((m) => m.type === "whitelist")
      .map((m) => m.meaning),
  ].map(normalizeMeaning);

  return accepted.includes(normalizedInput);
}

/** Reading is correct if the (romaji-converted) input matches an accepted reading. */
export function isReadingCorrect(input, subject) {
  const normalizedInput = normalizeReadingInput(input);
  if (!normalizedInput) return false;

  const accepted = (subject.readings || [])
    .filter((r) => r.accepted_answer)
    .map((r) => r.reading);

  return accepted.includes(normalizedInput);
}

export function primaryMeaning(subject) {
  return subject.meanings.find((m) => m.primary)?.meaning ?? subject.meanings[0]?.meaning;
}

export function primaryReading(subject) {
  return subject.readings?.find((r) => r.primary)?.reading ?? subject.readings?.[0]?.reading;
}

/** Strips WaniKani's mnemonic markup tags (<radical>, <kanji>, etc.) down to plain text. */
export function stripMnemonicMarkup(text) {
  if (!text) return text;
  return text.replace(/<\/?(radical|kanji|vocabulary|meaning|reading|ja)>/g, "");
}
