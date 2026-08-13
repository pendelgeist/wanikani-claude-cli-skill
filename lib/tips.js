/**
 * What this thing can do, in the words someone would actually say — not a
 * list of CLI flags. Everything here was, at some point, a feature nobody
 * knew about: "more" went unused because it lived in a skill file, and the
 * lookup link went unprinted for weeks. A feature nobody can find isn't
 * finished.
 *
 * It's a sheet you ask for, not a drip feed: the start-of-sitting note says
 * this list exists, and that's the last unsolicited word on the subject.
 * Order matters — first the things that change how you answer, then the
 * things that change what you get back, then the other ways in.
 */
export const TIPS = [
  'Say "more" after an item for its mnemonic, its parts, and the readings WaniKani isn\'t asking for.',
  'Meaning and reading go on one line, either order — "fur, ke" and "ke fur" both work.',
  "Answering a kanji with another of its real readings doesn't count against you — it just asks again, naming the type it wants.",
  'Readings take kana or romaji, and any IME spelling landing on the same kana — "du" and "dzu" are both づ.',
  'Say "wait" or "hold on" to stop the auto-advance between items; it stays that way for the rest of the sitting.',
  "Stopping mid-batch costs nothing — anything unsubmitted just comes back next time, unrecorded.",
  "Every correction ends in a lookup link: Jisho's kanji page for a kanji, its word page for vocabulary, WaniKani's own for a radical.",
  'Ask about any item any time — "what was 親 again?" — in a session or not.',
  'Ask for "wanikani lessons" and the same session teaches new items instead of quizzing you on old ones.',
  'Ask for "wanikani summary" for the quick check: level, what\'s due, when the next batch unlocks.',
];

export function tipsSheet() {
  return ["What you can say:", ...TIPS.map((tip) => `  · ${tip}`)].join("\n");
}
