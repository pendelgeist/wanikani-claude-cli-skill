import { srsStageName, srsTierName } from "./format.js";

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
  if (item.characterImageUrl) return `${number}![radical](${item.characterImageUrl})`;
  return null;
}

const accepted = (entries, key) =>
  (entries ?? []).filter((entry) => entry.accepted_answer).map((entry) => entry[key]);

/**
 * Ready-made reveal lines for an item the user got wrong. The reading is
 * copied verbatim out of the API's kana — never transliterated — so romaji
 * can't leak into a correction that nobody assembled by hand.
 */
export function correctionsFor(item) {
  const meanings = accepted(item.meanings, "meaning");
  const readings = accepted(item.readings, "reading");
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
