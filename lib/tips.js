import { readJsonCache, writeJsonCache } from "./cacheStore.js";

const TIPS_FILE = "tips-seen.json";

/**
 * What this thing can do, in the words someone would actually say — not a
 * list of CLI flags. Everything here was, at some point, a feature nobody
 * knew about: "more" went unused because it lived in a skill file, and the
 * lookup link went unprinted for weeks. A feature nobody can find isn't
 * finished.
 *
 * They surface one per batch summary and each is shown exactly once, ever, so
 * the advertising runs out instead of turning into wallpaper. Order matters:
 * first the things that change how you answer, then the things that change
 * what you get back, then the other ways in.
 */
export const TIPS = [
  {
    // The one feature the start-of-sitting note already carries, so it stays
    // out of the rotation and only appears on the full sheet — being told
    // twice in the same sitting reads like a bug.
    id: "more",
    inConvention: true,
    text: 'Say "more" after an item for its mnemonic, its parts, and the readings WaniKani isn\'t asking for.',
  },
  {
    id: "one-line",
    text: 'Meaning and reading go on one line, either order — "fur, ke" and "ke fur" both work.',
  },
  {
    id: "other-reading",
    text: "Answering a kanji with another of its real readings doesn't count against you — it just asks again, naming the type it wants.",
  },
  {
    id: "romaji",
    text: 'Readings take kana or romaji, and any IME spelling landing on the same kana — "du" and "dzu" are both づ.',
  },
  {
    id: "slow-down",
    text: 'Say "wait" or "hold on" to stop the auto-advance between items; it stays that way for the rest of the sitting.',
  },
  {
    id: "stop-anytime",
    text: "Stopping mid-batch costs nothing — anything unsubmitted just comes back next time, unrecorded.",
  },
  {
    id: "links",
    text: "Every correction ends in a lookup link: Jisho's kanji page for a kanji, its word page for vocabulary, WaniKani's own for a radical.",
  },
  {
    id: "explain-anything",
    text: 'Ask about any item any time — "what was 親 again?" — in a session or not.',
  },
  {
    id: "lessons",
    text: 'Ask for "wanikani lessons" and the same session teaches new items instead of quizzing you on old ones.',
  },
  {
    id: "summary",
    text: 'Ask for "wanikani summary" for the quick check: level, what\'s due, when the next batch unlocks.',
  },
];

async function loadSeen() {
  const raw = await readJsonCache(TIPS_FILE);
  return new Set(Array.isArray(raw?.seen) ? raw.seen : []);
}

/**
 * The next tip nobody's seen, or null once they've all been shown. Failing
 * quietly is the right failure here — a missing tip must never take down a
 * batch submission.
 */
export async function nextUnseenTip() {
  try {
    const seen = await loadSeen();
    return TIPS.find((tip) => !tip.inConvention && !seen.has(tip.id)) ?? null;
  } catch {
    return null;
  }
}

/** Best-effort: an unrecorded tip is shown twice, which is survivable. */
export async function markTipSeen(id) {
  try {
    const seen = await loadSeen();
    seen.add(id);
    await writeJsonCache(TIPS_FILE, { seen: [...seen] });
  } catch {
    // Ignored on purpose.
  }
}

export async function resetTipsSeen() {
  await writeJsonCache(TIPS_FILE, { seen: [] });
}

/** All of them at once, for when someone asks what this can do. */
export function tipsSheet(seen = new Set()) {
  const lines = ["What you can say:"];
  for (const tip of TIPS) {
    // Anything the sitting note already says isn't waiting to be discovered.
    lines.push(`  ${tip.inConvention || seen.has(tip.id) ? "·" : "▸"} ${tip.text}`);
  }
  lines.push("");
  lines.push("▸ marks the ones you haven't been shown yet — they turn up one per batch. `tips --reset` starts that over.");
  return lines.join("\n");
}

export async function tipsSheetWithProgress() {
  try {
    return tipsSheet(await loadSeen());
  } catch {
    return tipsSheet();
  }
}
