/**
 * Reads CHANGELOG.md as a list of releases, each a list of bullets, and works
 * out which bullets are new between two versions of the file.
 *
 * The changelog entries are written for whoever is doing the reviews, so they
 * run to paragraphs. What someone wants on a screen after `wanikani update` is
 * one line each, and every entry already opens with a bold lead that is
 * exactly that line — so that's what gets shown, falling back to the first
 * line of a bullet that doesn't have one.
 */

/** `## 2026-09-28` sections, each with its bullets joined onto single lines. */
export function parseChangelog(text) {
  const sections = [];
  let bullet = null;
  const flush = () => {
    if (bullet && sections.length) sections.at(-1).bullets.push(bullet.join(" ").replace(/\s+/g, " ").trim());
    bullet = null;
  };

  for (const line of (text ?? "").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      sections.push({ heading: heading[1], bullets: [] });
    } else if (/^- /.test(line)) {
      flush();
      bullet = [line.slice(2)];
    } else if (bullet && /^\s+\S/.test(line)) {
      bullet.push(line.trim());
    } else {
      flush();
    }
  }
  flush();
  return sections;
}

/** The one line a bullet gets: its bold lead, or failing that its first sentence-ish. */
export function summarise(bullet) {
  const lead = bullet.match(/^\*\*(.+?)\*\*/);
  if (lead) return lead[1].trim();
  return bullet.length > 100 ? `${bullet.slice(0, 97).trimEnd()}…` : bullet;
}

/**
 * Bullets present in `after` and not in `before`, grouped under their release
 * heading, newest first as the file has them. A bullet that was reworded
 * counts as new: it's been said again, so it's worth saying again.
 */
export function newEntries(before, after) {
  const seen = new Set(parseChangelog(before).flatMap((section) => section.bullets));
  return parseChangelog(after)
    .map((section) => ({
      heading: section.heading,
      bullets: section.bullets.filter((bullet) => !seen.has(bullet)).map(summarise),
    }))
    .filter((section) => section.bullets.length);
}

/** Markdown for `newEntries`: a heading per release, a bullet per change. */
export function formatEntries(entries, { headings = true } = {}) {
  return entries
    .map(({ heading, bullets }) => [...(headings ? [`${heading}`] : []), ...bullets.map((b) => `- ${b}`)].join("\n"))
    .join("\n\n");
}
