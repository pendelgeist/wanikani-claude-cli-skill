import * as wanakana from "wanakana";

/** Subject types that only quiz meaning (no reading part). */
const MEANING_ONLY_TYPES = new Set(["radical", "kana_vocabulary"]);

export function requiresReading(subjectType) {
  return !MEANING_ONLY_TYPES.has(subjectType);
}

function normalizeMeaning(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// wanakana maps the IME spellings "du"/"di" to づ/ぢ but leaves the equally
// common "dzu"/"dzi"/"dji" half-converted ("dzu" -> "dず"), which can never
// match an accepted reading. Fold them onto the spellings it does understand
// before converting.
function normalizeAmbiguousRomaji(text) {
  return text.replace(/(d)[zj]([ui])/gi, (_, d, vowel) => `${d}${vowel}`);
}

/** Converts romaji to kana (if it looks like romaji) and trims. Already-kana input passes through. */
export function normalizeReadingInput(text) {
  return wanakana.toKana(normalizeAmbiguousRomaji(text.trim()));
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

/** How WaniKani names each reading type when it tells you which one it wants. */
const READING_TYPE_LABELS = { onyomi: "on'yomi", kunyomi: "kun'yomi", nanori: "nanori" };

export function readingTypeLabel(type) {
  return READING_TYPE_LABELS[type] ?? null;
}

/**
 * Which reading type this item is asking for — `onyomi`, `kunyomi`, `nanori`,
 * or null when there's nothing single to name (vocabulary, whose readings
 * carry no type at all, or a kanji whose accepted readings span two types).
 */
export function wantedReadingType(subject) {
  const types = new Set(
    (subject.readings || []).filter((r) => r.accepted_answer).map((r) => r.type),
  );
  if (types.size !== 1) return null;
  const [type] = types;
  return READING_TYPE_LABELS[type] ? type : null;
}

/**
 * Readings the subject really has but won't accept here. Only typed ones
 * count: `type` is a kanji-only field, and a vocabulary word's non-accepted
 * readings are near-miss spellings (こころずよい for こころづよい) rather than
 * other legitimate ways to read the word — those stay plain wrong answers.
 */
export function unacceptedReadings(subject) {
  return (subject.readings || []).filter(
    (r) => !r.accepted_answer && readingTypeLabel(r.type),
  );
}

/**
 * Grades a reading the way the website's own input box does. A kanji usually
 * has more than one real reading and WaniKani wants a specific one; typing
 * another of its readings is not a wrong answer there — the box shakes, names
 * the type it's after, and lets you try again. Marking it wrong instead costs
 * SRS progress the website wouldn't have taken, so this returns three verdicts
 * rather than a boolean:
 *
 * - `correct`
 * - `other-reading` — a real reading of this subject, but not the one being
 *   asked for. Re-prompt; don't count it against the item.
 * - `incorrect`
 */
export function readingVerdict(input, subject) {
  if (isReadingCorrect(input, subject)) return { status: "correct" };

  const normalizedInput = normalizeReadingInput(input);
  const other =
    normalizedInput &&
    unacceptedReadings(subject).find((r) => r.reading === normalizedInput);
  if (!other) return { status: "incorrect" };

  return {
    status: "other-reading",
    gaveType: other.type,
    wantedType: wantedReadingType(subject),
  };
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
