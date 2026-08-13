import { srsStageName, srsTierName } from "./format.js";
import { readingTypeLabel, unacceptedReadings } from "./grading.js";

/**
 * Strings the CLI hands over ready to print, rather than describing in
 * SKILL.md and hoping they come back assembled correctly. Everything here is
 * deterministic given the API data — which is exactly why it belongs in code:
 * a prompt that quietly grew a gloss, and a correction that came back in
 * romaji, were both formatting bugs dressed up as instruction-following ones.
 */

/**
 * The question as it should appear, and nothing else: a number, the
 * characters, full stop. No gloss, no type label, no "meaning & reading?"
 * tail — naming the item is naming the answer. Returns null when there's
 * neither a glyph nor an image to show, which is the one case the caller has
 * to handle rather than prompt.
 */
export function promptFor(item, position) {
  const number = position == null ? "" : `${position}. `;
  if (item.characters) return `${number}${item.characters}`;
  // A bare URL, not markdown image syntax: a terminal won't render the image,
  // and an un-rendered `![radical](…)` invites describing the thing instead —
  // which is how a prompt ends up reading "Rib Cage image". The file URL is an
  // opaque hash, so it gives nothing away; `documentUrl` is the one whose slug
  // is the radical's name, which is why it never appears in a prompt.
  if (item.characterImageUrl) return `${number}${item.characterImageUrl}`;
  return null;
}

/**
 * The one-off note explaining how to answer, for the start of a sitting. It's
 * a string rather than an instruction to "mention the convention once"
 * because the alternative, in practice, is a `— meaning & reading?` tail
 * stapled to every single prompt.
 */
export const ANSWER_CONVENTION =
  "Meaning and reading together on one line — e.g. \"fur, ke\" — and I'll grade both. " +
  "Say \"more\" after an item for its mnemonic and parts, or \"what can I say?\" for the rest.";

/**
 * What to say when they answer with one of the subject's *other* readings —
 * the shake-and-retry the website does instead of marking it wrong. It names
 * the type being asked for, since that's the whole ambiguity: a kanji has
 * several real readings and nothing on the prompt says which one is wanted.
 * Deliberately reveals no kana — it's a re-prompt, not a correction.
 */
export function readingNudgeFor(wantedType) {
  const label = readingTypeLabel(wantedType);
  return label
    ? `That's a real reading, but WaniKani wants the ${label} here — try again.`
    : "That's a real reading, but not the one WaniKani wants here — try again.";
}

const accepted = (entries, key) =>
  (entries ?? []).filter((entry) => entry.accepted_answer).map((entry) => entry[key]);

/**
 * The reveal names the reading *type* as well as the kana, because "which of
 * this kanji's readings does WaniKani actually want?" is the question a missed
 * kanji reading usually leaves behind — and the answer is in the data, so it
 * shouldn't have to be inferred. Vocabulary readings carry no type and read
 * exactly as before.
 */
function describeReading(entry) {
  const label = readingTypeLabel(entry.type);
  return label ? `${entry.reading} (${label})` : entry.reading;
}

function describeAcceptedReadings(readings) {
  return (readings ?? []).filter((entry) => entry.accepted_answer).map(describeReading);
}

/** Where to read more about the item once it's been revealed. */
function lookupLink(item) {
  // Radicals are a WaniKani invention with WaniKani names — Jisho has nothing
  // to say about them, glyph or no glyph.
  if (item.subjectType === "radical" || !item.characters) return item.documentUrl;
  // A lone kanji's *word* page is its vocabulary entry — 親 lands on おや,
  // which is precisely the reading the correction just said WaniKani didn't
  // want. The kanji page lists on'yomi and kun'yomi side by side instead.
  if (item.subjectType === "kanji") return `https://jisho.org/search/${item.characters}%20%23kanji`;
  return `https://jisho.org/word/${item.characters}`;
}

/**
 * One finished line per way an item can be missed — meaning, reading, or both
 * — with the lookup link already on the end of each. The reading is copied
 * verbatim out of the API's kana, never transliterated, so romaji can't leak
 * into a correction nobody assembled by hand.
 *
 * The link is baked into the lines rather than offered alongside them because
 * a field that has to be remembered separately doesn't get printed: across
 * weeks of real sessions, not one lookup link reached the screen. There is now
 * nothing to print but a whole line.
 */
export function correctionsFor(item) {
  const meanings = accepted(item.meanings, "meaning");
  const readings = describeAcceptedReadings(item.readings);
  const link = lookupLink(item);

  const meaning = meanings.length ? `meaning is ${meanings.join(" / ")}` : null;
  const reading = readings.length ? `reading is ${readings.join(" / ")}` : null;
  const line = (...parts) => [...parts, link].join(" · ");

  return {
    meaning: meaning && line(meaning),
    reading: reading && line(reading),
    both: meaning && reading ? line(meaning, reading) : null,
  };
}

const SUBJECT_TYPE_LABELS = {
  radical: "radical",
  kanji: "kanji",
  vocabulary: "vocabulary",
  kana_vocabulary: "kana vocabulary",
};

/** "おや / した (kun'yomi)" — one label per type, not one per reading. */
function groupReadingsByType(readings) {
  const byType = new Map();
  for (const entry of readings) {
    if (!byType.has(entry.type)) byType.set(entry.type, []);
    byType.get(entry.type).push(entry.reading);
  }
  return [...byType]
    .map(([type, kana]) => `${kana.join(" / ")} (${readingTypeLabel(type)})`)
    .join(", ");
}

/** A component or the item itself, named by glyph where it has one. */
const nameOf = (characters, meaning) => (characters ? `${characters} (${meaning})` : `[${meaning}]`);

/**
 * Everything WaniKani knows about one item, as a block to print verbatim: the
 * mnemonics, the hints, what it's built from, where to read more.
 *
 * This is the item-info screen the website gives you *after* answering, and it
 * keeps that shape on purpose — it's a reveal, so it belongs to an item that
 * has already been graded, and it only ever appears because it was asked for.
 * Volunteering it after every miss turns a ten-item batch into a lecture.
 */
export function explainBlock(item) {
  const meanings = accepted(item.meanings, "meaning");
  const readings = (item.readings ?? []).filter((entry) => entry.accepted_answer);
  // Only the kanji readings, as everywhere else: a vocabulary word's rejected
  // readings are misspellings, and "also read こころずよい" would be a lie.
  const others = unacceptedReadings(item);
  const type = SUBJECT_TYPE_LABELS[item.subjectType] ?? item.subjectType;
  const speech = item.partsOfSpeech?.length ? `, ${item.partsOfSpeech.join(", ")}` : "";

  const lines = [`${item.characters ?? `[${meanings[0]}]`} — ${type}, level ${item.level}${speech}`];

  if (item.characterImageUrl) lines.push(`Image: ${item.characterImageUrl}`);
  if (meanings.length) lines.push(`Meaning: ${meanings.join(" / ")}`);
  if (readings.length) {
    // The other readings are the point of asking, half the time: 親 is しん
    // here and おや everywhere else, and knowing that is what stops the next
    // miss.
    const also = others.length ? ` — also read ${groupReadingsByType(others)}, though not here` : "";
    lines.push(`Reading: ${readings.map(describeReading).join(" / ")}${also}`);
  }
  if (item.components?.length) {
    lines.push(`Parts: ${item.components.map((c) => nameOf(c.characters, c.meaning)).join(" + ")}`);
  }
  if (item.meaningMnemonic) lines.push(`Meaning mnemonic: ${item.meaningMnemonic}`);
  if (item.meaningHint) lines.push(`  Hint: ${item.meaningHint}`);
  if (item.readingMnemonic) lines.push(`Reading mnemonic: ${item.readingMnemonic}`);
  if (item.readingHint) lines.push(`  Hint: ${item.readingHint}`);
  for (const sentence of (item.contextSentences ?? []).slice(0, 2)) {
    lines.push(`Example: ${sentence.ja} — ${sentence.en}`);
  }

  // Same link for both on a radical, where Jisho has nothing to add.
  const links = [...new Set([item.documentUrl, lookupLink(item)].filter(Boolean))];
  if (links.length) lines.push(`More: ${links.join(" · ")}`);

  return lines.join("\n");
}

function describeHighlight({ characters, tierChange, endingSrsStage }) {
  if (tierChange === "demoted") return `${characters} slipped to ${srsStageName(endingSrsStage)}`;
  return `${characters} → ${srsTierName(endingSrsStage)}`;
}

// Past a handful, naming every item stops being a highlight and becomes a list.
const MAX_NAMED_HIGHLIGHTS = 4;

function describeHighlights(highlights) {
  if (highlights.length === 0) return null;

  const nameable = highlights.every((highlight) => highlight.characters);
  if (nameable && highlights.length <= MAX_NAMED_HIGHLIGHTS) {
    return highlights.map(describeHighlight).join(", ");
  }

  const counts = { promoted: 0, burned: 0, demoted: 0 };
  for (const { tierChange } of highlights) counts[tierChange] += 1;

  return [
    counts.promoted && `${counts.promoted} moved up`,
    counts.burned && `${counts.burned} burned`,
    counts.demoted && `${counts.demoted} slipped back`,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The end-of-batch line: what just happened, what changed status, how far in
 * we are, and what's left. Segments that would say nothing are dropped rather
 * than padded — no "0 burned", no session total on the first batch.
 */
export function batchSummaryLine({
  submitted,
  perfect,
  failed = 0,
  highlights = [],
  remaining = null,
  sessionSubmitted = null,
  sessionPerfect = null,
}) {
  const segments = [`${submitted} done, ${perfect} perfect`];

  const changes = describeHighlights(highlights);
  if (changes) segments.push(changes);

  if (sessionSubmitted !== null && sessionSubmitted > submitted) {
    segments.push(`${sessionSubmitted} done this session${sessionPerfect === null ? "" : `, ${sessionPerfect} perfect`}`);
  }

  if (failed > 0) segments.push(`${failed} failed to submit`);
  if (remaining) segments.push(`${remaining} left`);

  return segments.join(" · ");
}
