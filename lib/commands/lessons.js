import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { primaryMeaning, primaryReading, stripMnemonicMarkup } from "../grading.js";
import { clickableUrl } from "../format.js";
import { getSubjectsCached } from "../subjectCache.js";
import { subjectView, teachingView } from "../subject.js";

/**
 * Lessons in level/lesson_position order — the order WaniKani teaches them in,
 * so radicals land before the kanji that use them.
 */
async function availableLessons(client) {
  const assignments = await client.getAssignments({ immediately_available_for_lessons: true });
  if (assignments.length === 0) return [];

  const subjects = await getSubjectsCached(client, assignments.map((a) => a.data.subject_id));
  return assignments
    .map((assignment) => ({ assignment, subject: subjects.get(assignment.data.subject_id) }))
    .filter((x) => x.subject)
    .sort(
      (a, b) =>
        a.subject.data.level - b.subject.data.level ||
        a.subject.data.lesson_position - b.subject.data.lesson_position,
    );
}

/**
 * Everything needed to teach an item, for a Claude-driven lesson session:
 * unlike `queue`, nothing here is withheld — the meaning and reading *are*
 * the lesson.
 */
function lessonPayload({ assignment, subject }) {
  return { assignmentId: assignment.id, ...subjectView(subject), ...teachingView(subject) };
}

export async function lessonsCommand(client, { start = false, limit, json = false } = {}) {
  const available = await availableLessons(client);
  const items = limit ? available.slice(0, limit) : available;

  if (json) {
    console.log(JSON.stringify(items.map(lessonPayload), null, 2));
    return;
  }

  if (available.length === 0) {
    console.log("No lessons available right now.");
    return;
  }

  console.log(
    `${available.length} lesson${available.length === 1 ? "" : "s"} available` +
      (items.length < available.length ? `, showing ${items.length}.` : "."),
  );

  const rl = start ? createInterface({ input: stdin, output: stdout }) : null;

  try {
    for (const { assignment, subject } of items) {
      const data = subject.data;
      const meaning = primaryMeaning(data);
      const reading = subject.object !== "radical" ? primaryReading(data) : null;

      console.log(`\n${data.characters ?? `[${meaning}]`} — ${meaning}${reading ? ` (${reading})` : ""}`);
      console.log(`  ${stripMnemonicMarkup(data.meaning_mnemonic)}`);
      if (data.reading_mnemonic) console.log(`  ${stripMnemonicMarkup(data.reading_mnemonic)}`);
      console.log(`  ${clickableUrl(data.document_url)}`);

      if (rl) {
        const answer = await rl.question("  Mark as started (moves to review queue)? [y/N] ");
        if (answer.trim().toLowerCase().startsWith("y")) {
          await client.startAssignment(assignment.id);
          console.log("  → started");
        }
      }
    }
  } finally {
    rl?.close();
  }
}
