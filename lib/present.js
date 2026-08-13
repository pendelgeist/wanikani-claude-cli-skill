import { srsStageName, srsTierName } from "./format.js";
import { readingTypeLabel } from "./grading.js";

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
  "Meaning and reading together on one line — e.g. \"fur, ke\" — and I'll grade both.";

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
function describeAcceptedReadings(readings) {
  return (readings ?? [])
    .filter((entry) => entry.accepted_answer)
    .map((entry) => {
      const label = readingTypeLabel(entry.type);
      return label ? `${entry.reading} (${label})` : entry.reading;
    });
}

/**
 * Ready-made reveal lines for an item the user got wrong. The reading is
 * copied verbatim out of the API's kana — never transliterated — so romaji
 * can't leak into a correction that nobody assembled by hand.
 */
export function correctionsFor(item) {
  const meanings = accepted(item.meanings, "meaning");
  const readings = describeAcceptedReadings(item.readings);
  return {
    meaning: meanings.length ? `meaning is ${meanings.join(" / ")}` : null,
    reading: readings.length ? `reading is ${readings.join(" / ")}` : null,
    // Radicals aren't words Jisho knows, so those fall back to WaniKani's page.
    link: item.characters ? `https://jisho.org/word/${item.characters}` : item.documentUrl,
  };
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
