import { getSubjectsCached, loadSubjectCache } from "../subjectCache.js";
import { primaryMeaning } from "../grading.js";
import { subjectView, teachingView } from "../subject.js";
import { explainBlock } from "../present.js";
import { lastSettledItem, openItems } from "../queueOrder.js";

/**
 * The item-info screen, on demand: everything WaniKani teaches about one
 * subject, for the moment mid-review when "I know I missed that, but why is it
 * しん?" is worth thirty seconds. Never run unasked — see SKILL.md.
 *
 * Takes a subject id (what `queue` hands over) or the characters themselves
 * (what a human types). Characters can be ambiguous — 親 is a kanji *and* a
 * word — so that path explains every subject that matches rather than picking.
 */
async function resolveSubjects(client, target) {
  if (/^\d+$/.test(target)) {
    const id = Number(target);
    const subjects = await getSubjectsCached(client, [id]);
    const subject = subjects.get(id);
    return subject ? [subject] : [];
  }

  // The session's own batch is already cached, so the common case — asking
  // about the item just answered — costs no API call at all.
  const cache = await loadSubjectCache();
  const cached = [...cache.subjects.values()].filter((subject) => subject?.data?.characters === target);
  if (cached.length > 0) return cached;

  return client.getSubjectsBySlugs([target]);
}

/**
 * What a bare `explain` means: the item this batch last *finished* with.
 *
 * It used to mean the item that was open, which is the one item whose entry
 * nobody may see. A sitting proved it: 欠く was graded, `ask` printed 成 under
 * the correction, the user said "explain" — and out came `Meaning: Become`
 * and `Reading: せい`, the answer to the question then on screen. 成 was
 * re-asked, answered with nonsense, and recorded as a miss on both halves
 * with its answer sitting a few lines up.
 *
 * SKILL.md had warned about exactly this in prose ("bare there would explain
 * the next item and hand over its answer") and prose lost, the way it has
 * every other time a decision was left in it. So the command decides now:
 * bare is the item just graded, which is both what people mean once a verdict
 * is on screen and the only reading that can never hand over an answer.
 */
async function settledTarget() {
  const settled = await lastSettledItem();
  return settled ? String(settled.subjectId) : null;
}

/**
 * The items this batch is still waiting on — the ones whose entries are the
 * answer to a question already asked. Includes an item that's given its
 * meaning and still owes a reading: the entry would hand over the half
 * that's outstanding.
 */
async function unanswered() {
  const open = await openItems();
  return Array.isArray(open) ? open : [];
}

const NOTHING_TO_EXPLAIN =
  "Nothing has been answered yet, so there's no \"this one\" to explain — name the item: " +
  "`explain 親`, or the subjectId from the queue.";

/**
 * The refusal for a bare `explain` with a batch underway and nothing settled
 * in it: item one is on screen and it is the only thing "this one" could mean.
 * Named rather than described, so nobody has to go looking for which.
 */
function openBlocks(open) {
  if (open.length === 0) return null;
  return (
    "! Nothing in this batch is answered yet, and a bare `explain` is the item you just finished with. " +
    "The one on screen can't be it — its entry is the answer. Answer it first, or name a different item: " +
    "`explain 親`."
  );
}

async function componentsOf(client, subject) {
  const ids = subject.data.component_subject_ids ?? [];
  if (ids.length === 0) return [];

  const subjects = await getSubjectsCached(client, ids);
  return ids
    .map((id) => subjects.get(id))
    .filter(Boolean)
    .map((component) => ({
      characters: component.data.characters,
      meaning: primaryMeaning(component.data),
    }));
}

function explainPayload(subject, components) {
  return {
    ...subjectView(subject),
    ...teachingView(subject),
    partsOfSpeech: subject.data.parts_of_speech ?? [],
    components,
    contextSentences: subject.data.context_sentences ?? [],
  };
}

export async function explainCommand(client, { target, json = false } = {}) {
  const open = await unanswered();
  const asked = target ?? (await settledTarget());
  if (!asked) {
    console.log(openBlocks(open) ?? NOTHING_TO_EXPLAIN);
    return;
  }

  const subjects = await resolveSubjects(client, asked);

  // Named or resolved, an item the batch is still waiting on doesn't get
  // explained — its entry *is* the answer, and the answer is what the user is
  // about to be scored on. The website locks item info until you've answered
  // for the same reason.
  const stillOpen = subjects.find((subject) => open.some((entry) => entry.subjectId === subject.id));
  if (stillOpen) {
    console.log(
      `! ${stillOpen.data.characters ?? `Subject ${stillOpen.id}`} is still open, and its entry is the ` +
        "answer to the question on screen — the website locks item info until you've answered too. " +
        "Answer it and a bare `explain` gives you the whole thing.",
    );
    return;
  }

  if (subjects.length === 0) {
    console.log(
      `Nothing found for "${asked}" — pass the subjectId from the queue, ` +
        `or the characters exactly as WaniKani writes them.`,
    );
    return;
  }

  const payloads = [];
  for (const subject of subjects) {
    payloads.push(explainPayload(subject, await componentsOf(client, subject)));
  }

  if (json) {
    console.log(JSON.stringify(payloads, null, 2));
    return;
  }

  console.log(payloads.map(explainBlock).join("\n\n"));
}
