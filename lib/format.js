/** "2m", "3h 10m", "2d" — the size of a gap, without saying which way it runs. */
function describeDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatRelativeToNow(isoDate) {
  if (!isoDate) return "unknown";
  const diffMs = new Date(isoDate).getTime() - Date.now();
  if (diffMs <= 0) return "now";
  return describeDuration(diffMs);
}

/**
 * How long ago. Separate from the countdown because that one reports anything
 * past as "now" — right for "next reviews in…", useless for "this sitting was
 * last touched…".
 */
export function formatAgo(isoDate) {
  if (!isoDate) return "unknown";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  return diffMs < 60000 ? "under a minute" : describeDuration(diffMs);
}

const SRS_STAGE_NAMES = [
  "Lesson",
  "Apprentice 1",
  "Apprentice 2",
  "Apprentice 3",
  "Apprentice 4",
  "Guru 1",
  "Guru 2",
  "Master",
  "Enlightened",
  "Burned",
];

export function srsStageName(stage) {
  return SRS_STAGE_NAMES[stage] ?? `Stage ${stage}`;
}

// The tier is the part worth calling out after a review — "Apprentice 3 →
// Apprentice 4" is noise, "Apprentice 4 → Guru 1" is the thing you wanted.
const SRS_TIERS = [
  { name: "Lesson", maxStage: 0 },
  { name: "Apprentice", maxStage: 4 },
  { name: "Guru", maxStage: 6 },
  { name: "Master", maxStage: 7 },
  { name: "Enlightened", maxStage: 8 },
  { name: "Burned", maxStage: 9 },
];

export function srsTierName(stage) {
  if (!Number.isInteger(stage)) return `Stage ${stage}`;
  return SRS_TIERS.find((tier) => stage <= tier.maxStage)?.name ?? `Stage ${stage}`;
}

/**
 * Classifies a review's stage movement as "burned" / "promoted" / "demoted",
 * or null when it stayed inside the same tier (most reviews). Callers use it
 * to pick out the handful of items worth mentioning in a batch summary.
 */
export function srsTierChange(startingStage, endingStage) {
  if (!Number.isInteger(startingStage) || !Number.isInteger(endingStage)) return null;
  if (srsTierName(startingStage) === srsTierName(endingStage)) return null;
  if (endingStage >= 9) return "burned";
  return endingStage > startingStage ? "promoted" : "demoted";
}
