export function formatRelativeToNow(isoDate) {
  if (!isoDate) return "unknown";
  const diffMs = new Date(isoDate).getTime() - Date.now();
  if (diffMs <= 0) return "now";

  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
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
