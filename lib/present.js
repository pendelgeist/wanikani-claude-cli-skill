import { clickableUrl, srsStageName, srsTierName } from "./format.js";
import { readingTypeLabel, unacceptedReadings, wantedReadingType } from "./grading.js";

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
 *
 * The tail was issued from here for exactly one release. Four sittings had
 * composed one of their own, in four spellings, so fixing the wording and
 * welding it to the glyph looked like conceding to the inevitable. What the
 * next sitting did with a question that arrived already complete was answer
 * it: on four items out of five the *answer* went into the chat under the
 * prompt, and on one of them the user's correct reply was passed over and the
 * model's own wrong guess handed to `grade` in its place — a right answer
 * recorded as a miss. The urge that had been coming out as a harmless tail
 * came out as an answer the moment the tail had nothing left to do. So the
 * prompt is a fragment again, on purpose, and what stops the message being
 * finished by hand is that there is no message: see SKILL.md on `grade`.
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
 * The note that rides with every batch, for whoever is driving rather than for
 * the user. It repeats on every fetch because a sitting outlives a
 * conversation: the once-a-sitting strings are keyed to the file on disk, so a
 * fresh session picking up a batch mid-sitting is handed a list of questions
 * and no idea what to do with them.
 *
 * That session wrote a script against the WaniKani API to pull the answer key,
 * graded all ten items in chat from it, and only then discovered that
 * `submit-batch` had nothing to submit and every item had to be graded again.
 * The key was never the missing piece — the record was.
 */
export const GRADING_NOTE =
  'Answers aren\'t in this payload and don\'t need to be: `grade <subjectId> "<their whole reply>"` ' +
  "holds the key, records the miss, and returns the line to print. A verdict written in chat isn't a " +
  "record — `submit-batch` submits what `grade` recorded and nothing else — so fetching the answers " +
  "another way buys a grading that can't be submitted.";

/**
 * The one line for whoever is *driving*, rather than for the user — and it
 * goes to stderr, because it isn't part of the session.
 *
 * Once a sitting, alongside `ANSWER_CONVENTION`. It used to ride every batch,
 * on the theory that a sitting outlives a conversation and a session picking
 * one up mid-way needs telling. What that actually bought was seven copies of
 * it in a sixty-one item sitting, and Claude Code shows the first lines of a
 * command's output and collapses the rest — so the note was on screen and the
 * question it came with was the part behind "+2 lines". The mid-sitting case
 * is covered by SKILL.md, which every conversation loads; burying the prompt
 * is not covered by anything.
 *
 * It is short on purpose. The long version of this note lived in `queue`'s
 * payload and was read by a driver that then went and hand-graded the batch
 * anyway. What actually stops that isn't the paragraph; it's that `answer`
 * now needs nothing a driver could get wrong.
 */
export const DRIVER_NOTE =
  'Driving: `answer "<their whole reply>"` grades whatever is open — no id, no batch to track — and ' +
  "prints the verdict and the next question itself. That output is the message; add nothing to it.";

/**
 * The note on a drill batch. Same job as the one above: whoever is driving
 * needs to know where this one *doesn't* go.
 */
export const DRILL_NOTE =
  "A drill, not a review: none of these are due and none of them submit. `grade <subjectId> " +
  '"<their whole reply>"` grades them the same way and prints the same line, and says it isn\'t ' +
  "recording. Ask them one at a time, same as a batch.";

/**
 * The note on a critical-condition batch — `DRILL_NOTE` with its provenance
 * in front of it, because the two lists answer different questions and the
 * difference is worth one clause. `drill` is what *this tool* saw you get
 * wrong; this is what WaniKani's own records say you keep getting wrong,
 * over your whole history with the item and whatever you reviewed it in.
 *
 * It says how many were held back too. The default is ten and the list is
 * routinely twenty-plus, so without it the second half of someone's critical
 * items is invisible and nothing on screen suggests otherwise.
 */
export function criticalNote({ total, shown, under }) {
  const held =
    total > shown ? ` The worst ${shown} of ${total} — \`critical --limit ${total}\` for all of them.` : "";
  return `WaniKani's own critical-condition list: every item it has you under ${under}% on, worst first.${held} ${DRILL_NOTE}`;
}

/** The follow-up when they gave a right meaning and no reading yet. */
/**
 * Said under a correction when the answer was wrong by a hair.
 *
 * `--forgive` was documented in the skill file and used exactly never, across
 * six sittings that included several plain typos — the same way the lookup
 * link went unprinted for weeks while it lived in prose. So the offer is on
 * the screen now, next to the verdict it applies to. It offers and nothing
 * more: the miss stays on the record until somebody decides otherwise.
 */
export const NEAR_MISS = "(close — `answer --forgive meaning` if that was a typo)";

export const ASK_READING = "Reading?";

/**
 * What to say when an answer arrives for an item this batch already settled.
 *
 * A miss ends the item — the correction reveals both halves — so a second
 * answer to it can only be the reveal typed back. A real session did exactly
 * that six times: `grade` returned "meaning is Public Official / Government
 * Official", the session replied "Try 'public official'?", the user typed it,
 * and it came back ✓. The record still held the miss (attempts add up), so
 * what the ✓ actually did was tell the user they'd got right what they'd got
 * wrong. Hence: the line names what's recorded, and the only way to change it
 * is the override that says so.
 */
export function alreadyAnsweredLine({ characters, subjectId, grade }) {
  const missed = [grade.wrongMeaning > 0 && "meaning", grade.wrongReading > 0 && "reading"].filter(Boolean);
  const name = characters ? `${characters} was` : "That item was";
  if (missed.length === 0) {
    return (
      `${name} already answered this batch — no misses, and that's what submits. ` +
      "Nothing left to do with it: a second answer can only add a miss to an item that hasn't got one."
    );
  }
  return (
    `${name} already answered this batch — ${missed.join(" and ")} missed, and that's what submits. ` +
    "No second try: the correction has already shown the answer, so a re-ask grades the reveal. " +
    `Overruling it — a typo, or a synonym the key doesn't list? \`grade ${subjectId} --forgive ${missed[0]}\`.`
  );
}

/**
 * How to answer a whole batch at once, said once at the top of the list.
 *
 * `|` is the separator here even though `grade` also accepts it *within* an
 * answer, because a list needs one unambiguous divider and this is the one
 * people reach for. Saying so is the point: the alternative is guessing which
 * of eleven pipes were meant as item boundaries.
 */
export const RAPID_CONVENTION =
  'All in one message, in order, separated by "|" — meaning and reading together on each, ' +
  'e.g. "fur, ke | side, yoko". Answer as few as you like; the rest keep.';

/**
 * The whole open batch as one block to print — the same numbered prompts as
 * the one-at-a-time flow, stacked, with the how-to line under them.
 *
 * It exists because the alternative is composing that list in chat, and a
 * session that composed one wrote out nine items as `shore/kishi |
 * city/town/village/shichouchouson | …` — every meaning and reading recalled
 * from memory (two of them wrong) and handed to the user as the question. The
 * prompts are already in the data; nothing here has to be remembered.
 */
export function promptListFor(items, { convention = true } = {}) {
  const lines = items.map((item) => {
    const prompt = promptFor(item, item.position);
    return prompt ?? `${item.position}. (no glyph and no image — skip this one)`;
  });
  // The how-to goes under the opening list and not under the two items left
  // over from it, for the same reason the answer convention is said once a
  // sitting: an instruction repeated every round is longer than the round.
  return (convention ? [...lines, RAPID_CONVENTION] : lines).join("\n");
}

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

/**
 * The two fields that make a near-miss reading a re-prompt instead of a
 * mark-down: which answers should trigger one, and what to say. They travel
 * together and are absent together, so they're composed together — a caller
 * that assembles them itself is a caller that can ship one without the other.
 */
export function otherReadingHelp(subject) {
  const others = unacceptedReadings(subject);
  if (others.length === 0) return null;
  return {
    otherReadings: others.map((entry) => entry.reading),
    readingNudge: readingNudgeFor(wantedReadingType(subject)),
  };
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
  if (item.subjectType === "kanji") {
    return clickableUrl(`https://jisho.org/search/${item.characters}%20%23kanji`);
  }
  return clickableUrl(`https://jisho.org/word/${item.characters}`);
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

function describeFailures({ retryable, dropped }) {
  const parts = [];
  if (retryable) parts.push(`${retryable} ${retryable === 1 ? "stays" : "stay"} in the queue for a later batch`);
  if (dropped) {
    parts.push(
      `${dropped} ${dropped === 1 ? "was" : "were"} rejected outright and won't come back` +
        " — usually an item already reviewed somewhere else",
    );
  }
  return parts.length ? `${parts.join("; ")}.` : null;
}

/**
 * The end-of-batch line: what just happened, what changed status, how far in
 * we are, and what's left. Segments that would say nothing are dropped rather
 * than padded — no "0 burned", no session total on the first batch.
 */
export function batchSummaryLine({
  submitted,
  perfect,
  unanswered = 0,
  carriedMisses = 0,
  failures = null,
  highlights = [],
  remaining = null,
  sessionSubmitted = null,
  sessionPerfect = null,
}) {
  const segments = [`${submitted} done, ${perfect} perfect`];

  // Asked and never graded. It goes in the line because the gap between "ten
  // items went past on screen" and "six were recorded" is invisible otherwise:
  // one session answered ten, graded six, and reported ten to the user.
  if (unanswered > 0) segments.push(`${unanswered} left unanswered — still due, back next batch`);

  // Said out loud because it changes what went in. Silently adding a miss the
  // user can't see is the same class of thing as silently dropping one.
  if (carriedMisses > 0) segments.push(`${carriedMisses} kept a miss from earlier this sitting`);

  const changes = describeHighlights(highlights);
  if (changes) segments.push(changes);

  if (sessionSubmitted !== null && sessionSubmitted > submitted) {
    segments.push(`${sessionSubmitted} done this sitting${sessionPerfect === null ? "" : `, ${sessionPerfect} perfect`}`);
  }

  const { retryable = 0, dropped = 0 } = failures ?? {};
  const failed = retryable + dropped;
  if (failed > 0) segments.push(`${failed} failed to submit`);
  if (remaining) segments.push(`${remaining} left`);

  // What happens to a failed item next is the first thing anyone asks, and
  // it's knowable from the error — so the line answers it rather than leaving
  // the answer to be recalled from a skill file at the worst moment.
  const fate = describeFailures({ retryable, dropped });
  return fate ? `${segments.join(" · ")}\n${fate}` : segments.join(" · ");
}
