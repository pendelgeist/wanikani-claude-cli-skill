import * as wanakana from "wanakana";

/** Subject types that only quiz meaning (no reading part). */
const MEANING_ONLY_TYPES = new Set(["radical", "kana_vocabulary"]);

export function requiresReading(subjectType) {
  return !MEANING_ONLY_TYPES.has(subjectType);
}

// Trailing punctuation is how people type, not part of the answer: "to
// realize." is the same meaning as "to realize", and grading it wrong for a
// full stop would be the pettiest possible miss.
const TRIM_PUNCTUATION = /^[\s.,;!?、。]+|[\s.,;!?、。]+$/g;

function normalizeMeaning(text) {
  return text.trim().toLowerCase().replace(TRIM_PUNCTUATION, "").replace(/\s+/g, " ");
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

// A bare "n" before a vowel or a "y" is ambiguous in romaji and always has
// been: "shinyuu" is しんゆう to a reader and しにゅう to a converter, which is
// why strict Hepburn writes shin'yū. wanakana resolves it one way, so 親友
// answered "shinyuu" came back wrong — a reading the user plainly knew.
const AMBIGUOUS_N = /n(?=[yaiueo])/gi;

// A long vowel is written ー in katakana and doubled in romaji: ページ is
// "peeji" to most people and "pe-ji" to a converter. Typing the vowel twice
// is not a different reading, it's the same one spelled the way English
// speakers spell it.
const REPEATED_VOWEL = /(?<=[ぁ-んァ-ヶ])[あいうえおアイウエオ]/g;

// Doubling the n is how every Japanese IME is taught to type ん — 神社 is
// "jinnja" to anyone who learned to type on one. wanakana reads it as two,
// so じんんじゃ came back wrong for a reading the user had right.
const DOUBLED_N = /nn/gi;

// An apostrophe only means anything in romaji directly after an n, where it
// closes off ん. Anywhere else it's punctuation someone's habit put there —
// "ji'n'jya" is じんじゃ with one apostrophe doing a job and one along for the
// ride, and the spare one converted to a literal ' that matched nothing.
const STRAY_APOSTROPHE = /(?<!n)'/g;

/**
 * Every kana this romaji could reasonably mean. Each alternate is only ever
 * *accepted* when it turns out to be one of the item's readings, so none of
 * them can promote a wrong answer — they only stop punctuation deciding
 * whether someone knew the word.
 */
export function readingCandidates(input) {
  const text = normalizeAmbiguousRomaji((input ?? "").trim()).replace(STRAY_APOSTROPHE, "");
  const asTyped = wanakana.toKana(text);
  return [
    ...new Set(
      [
        asTyped,
        wanakana.toKana(text.replace(AMBIGUOUS_N, "n'")),
        wanakana.toKana(text.replace(DOUBLED_N, "n'")),
        asTyped.replace(REPEATED_VOWEL, "ー"),
      ].filter(Boolean),
    ),
  ];
}

/**
 * Edit distance over two normalized meanings, counting a swap of two adjacent
 * letters as one edit rather than two. That last part is the whole reason to
 * write it out: "hte" and "cheif" are the typos people actually make, and
 * charging them double puts them outside the tolerance below.
 *
 * Only ever asked about strings a few dozen characters long.
 */
function editDistance(a, b) {
  let twoBack = null;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(previous[j - 1] + cost, previous[j] + 1, current[j - 1] + 1);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, twoBack[j - 2] + cost);
      }
      current[j] = best;
    }
    twoBack = previous;
    previous = current;
  }
  return previous[b.length];
}

/**
 * How many typos to let through in a meaning of this length, the way the
 * website does: none in a word short enough that one edit makes it a
 * different word, one in an ordinary word, two in a phrase.
 *
 * This is a real grading rule, not leniency for its own sake. "government
 * offical" was marked wrong in a session, and what followed was worse than the
 * miss: the correction handed over the meaning, the same item was asked again,
 * and the answer was typed back from the line that had just revealed it. The
 * website accepts that answer, so it counts here too.
 */
function typoTolerance(text) {
  if (text.length <= 3) return 0;
  if (text.length <= 7) return 1;
  return 2;
}

/** How far the input is from the nearest of these, or Infinity if there are none. */
const nearest = (input, candidates) =>
  candidates.reduce((best, candidate) => Math.min(best, editDistance(input, candidate)), Infinity);

/**
 * Meaning is correct if it matches a subject meaning (or a whitelisted auxiliary
 * meaning), give or take a typo, and isn't a blacklisted auxiliary meaning.
 *
 * Exact matches settle it either way, in that order. Only when neither does is
 * the distance measured, and then the nearest meaning wins: a slip on a
 * blacklisted meaning — the ones that look right and aren't — is still that
 * meaning, unless the input is closer to something the item actually accepts.
 */
export function isMeaningCorrect(input, subject) {
  const normalizedInput = normalizeMeaning(input);
  if (!normalizedInput) return false;

  const accepted = [
    ...subject.meanings.filter((m) => m.accepted_answer).map((m) => m.meaning),
    ...(subject.auxiliary_meanings || [])
      .filter((m) => m.type === "whitelist")
      .map((m) => m.meaning),
  ].map(normalizeMeaning);
  if (accepted.includes(normalizedInput)) return true;

  const blacklist = (subject.auxiliary_meanings || [])
    .filter((m) => m.type === "blacklist")
    .map((m) => normalizeMeaning(m.meaning));
  if (blacklist.includes(normalizedInput)) return false;

  const closest = accepted.filter((entry) => editDistance(normalizedInput, entry) <= typoTolerance(entry));
  if (closest.length === 0) return false;
  return nearest(normalizedInput, closest) <= nearest(normalizedInput, blacklist);
}

/**
 * One script, so that comparing readings compares sounds.
 *
 * Nobody answering a review picks hiragana or katakana on purpose — but two
 * things decide it for them, and both were marking right answers wrong.
 * Letter case is one: wanakana reads capitals as a katakana signal, so `SHIN`
 * became シン and missed しん, and caps lock, dictation or a phone that
 * capitalises for you were enough to lose an item. The other is the item
 * itself: ページ's reading *is* katakana, so the romaji anyone would type for
 * it came out ぺーじ and matched nothing — a false miss on every katakana word
 * in WaniKani.
 *
 * Comparing by sound settles both. It can't promote a wrong answer, because
 * しん and シン are the same answer read aloud, which is the only sense in
 * which a reading is right.
 */
const bySound = (kana) =>
  // `convertLongVowelMark: false` because the default rewrites katakana ー as
  // the vowel it stands for — ページ would normalize to ぺえじ while ぺーじ
  // stayed ぺーじ, and the two spellings of one word would still miss each
  // other. The mark is the same sound in either script; leave it alone.
  wanakana.toHiragana(kana ?? "", { convertLongVowelMark: false });

/** Reading is correct if any reading the input could mean is an accepted one. */
export function isReadingCorrect(input, subject) {
  const candidates = readingCandidates(input).filter(Boolean).map(bySound);
  if (candidates.length === 0) return false;

  const accepted = (subject.readings || [])
    .filter((r) => r.accepted_answer)
    .map((r) => bySound(r.reading));

  return candidates.some((candidate) => accepted.includes(candidate));
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

  const candidates = readingCandidates(input).filter(Boolean).map(bySound);
  const other = unacceptedReadings(subject).find((r) => candidates.includes(bySound(r.reading)));
  if (!other) return { status: "incorrect" };

  return {
    status: "other-reading",
    gaveType: other.type,
    wantedType: wantedReadingType(subject),
  };
}

// "fur, ke" · "fur / ke" · "fur | ke" · "fur、ke" · "to realize. kidzuku" ·
// "fur x ke" — whichever separator came to hand. The two that are also
// ordinary characters need whitespace to count: a bare full stop would cut a
// decimal in half, and a bare "x" would cut "X-ray" in half.
const EXPLICIT_SEPARATORS = /\s*[,、;/|・]\s*|\.\s+|\s+x\s+/i;

const looksLikeReading = (text, subject) =>
  readingVerdict(text, subject).status !== "incorrect" || wanakana.isKana(text);

/**
 * Splits one reply into its meaning and reading halves. The user types them
 * on a single line, in either order, separated by whatever came to hand — so
 * the split is decided by *grading* the candidates rather than by looking at
 * them: the half that is a real reading of this item is the reading, and the
 * rest is the meaning. That also means "ke fur" and "fur ke" land the same
 * way round without a rule about word order.
 *
 * Either half comes back null when the reply plainly only holds the other —
 * a meaning-only subject, or a follow-up answering just the reading.
 */
export function splitAnswer(raw, subject, needsReading) {
  const text = (raw ?? "").trim();
  if (!needsReading) return { meaning: meaningOnly(text, subject), reading: null };
  if (!text) return { meaning: null, reading: null };

  const parts = text.split(EXPLICIT_SEPARATORS).filter(Boolean);
  const words = text.split(/\s+/);
  const candidates = [];

  const pair = (pieces, join) => {
    if (pieces.length < 2) return;
    candidates.push({ meaning: pieces.slice(0, -1).join(join), reading: pieces.at(-1) });
    candidates.push({ meaning: pieces.slice(1).join(join), reading: pieces[0] });
  };
  pair(parts, ", ");
  if (parts.length < 2) pair(words, " ");

  const split = candidates.find((candidate) => looksLikeReading(candidate.reading, subject));
  if (split) return split;

  // Nothing graded as a reading, so the reply is one part or the other. A
  // recognised meaning settles it; otherwise kana is a reading and anything
  // else is a wrong meaning, which is the likelier miss.
  if (isMeaningCorrect(text, subject)) return { meaning: text, reading: null };
  if (wanakana.isKana(text)) return { meaning: null, reading: text };
  if (candidates.length > 0) return candidates[0];
  return { meaning: text, reading: null };
}

/**
 * A meaning-only item's reply, with a volunteered reading trimmed off it.
 *
 * Radicals and kana vocabulary take no reading, but the habit of a sitting is
 * "meaning, reading" on one line and it doesn't switch off for one item in
 * ten: `orders. rei` is the answer to a question that only asked for
 * `orders`. Grading the whole line as the meaning made that a miss — and the
 * session driving the quiz noticed, and started quietly trimming replies
 * before passing them in, which is the one thing the hand-over rule exists to
 * stop. The parse is what was wrong, so the parse is what's fixed.
 *
 * Only a *correct* leading answer sheds its tail. A reply whose first segment
 * is wrong stays wrong however many more it carries, so this tolerates a
 * volunteered reading without tolerating a spray of guesses.
 */
function meaningOnly(text, subject) {
  if (!text) return null;
  if (isMeaningCorrect(text, subject)) return text;

  const parts = text.split(EXPLICIT_SEPARATORS).filter(Boolean);
  if (parts.length === 2 && isMeaningCorrect(parts[0], subject)) return parts[0];
  return text;
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
