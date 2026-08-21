import { readJsonCache, writeJsonCache } from "./cacheStore.js";

const ORDER_FILE = "queue-order.json";

// Long enough to cover a sitting, short enough that reviews unlocking on the
// hour surface on their own rather than waiting for the queue to run dry.
//
// It runs from the last time the sitting was *touched*, not from the fetch.
// Measuring from the fetch made a long sitting expire underneath itself: forty
// minutes in, mid-batch, `loadQueueOrder` started returning null, which took
// the grade record with it — every answer after that graded fine and recorded
// nothing, and `submit-batch` reported an empty batch once ten items had
// already been answered.
const IDLE_TTL_MS = 30 * 60 * 1000;

/**
 * Whatever sitting is on disk, however old — `{ fetchedAt, touchedAt, items,
 * totals, grades }` or null if there isn't one.
 *
 * The age matters for deciding whether to *serve* this list again (stale
 * items, and reviews unlocked since), and not at all for the grades recorded
 * against it: a miss on an assignment is a fact about that assignment, and
 * dropping it on a timer is how ten answered items came to submit as nothing.
 * Recording reads through this; fetching reads through `loadQueueOrder`.
 */
export async function loadSitting() {
  const raw = await readJsonCache(ORDER_FILE);
  if (!raw?.fetchedAt || !Array.isArray(raw.items)) return null;
  return raw;
}

/**
 * The sitting, but only while it's still current: null once it's been idle
 * long enough that the list should be fetched again.
 */
export async function loadQueueOrder() {
  const raw = await loadSitting();
  if (!raw) return null;
  // Orders written before there was a touchedAt fall back to the fetch time.
  const lastActivity = raw.touchedAt ?? raw.fetchedAt;
  if (Date.now() - new Date(lastActivity).getTime() > IDLE_TTL_MS) return null;
  return raw;
}

/**
 * Marks the sitting as still in progress. Every write does this implicitly;
 * this is for the one thing that only reads — asking for the next batch is
 * activity too.
 */
export async function touchQueueOrder() {
  const order = await loadSitting();
  if (!order) return false;
  await rewrite(order, {});
  return true;
}

export async function saveQueueOrder(
  items,
  {
    fetchedAt = new Date().toISOString(),
    totals = { submitted: 0, perfect: 0 },
    grades = {},
    priorGrades = {},
    served = [],
    toldRapid = false,
  } = {},
) {
  await writeJsonCache(ORDER_FILE, {
    fetchedAt,
    touchedAt: new Date().toISOString(),
    items,
    totals,
    grades,
    priorGrades,
    served,
    toldRapid,
  });
}

/**
 * Writes back one part of a sitting and leaves the rest alone. Every mutation
 * below is "read it, change one field, save it all again", and spelling that
 * out six times is six chances to drop the field you weren't thinking about —
 * which is how a batch could lose its `served` list to a `--forgive`.
 */
function rewrite(order, changes) {
  return saveQueueOrder(changes.items ?? order.items, {
    fetchedAt: order.fetchedAt,
    totals: changes.totals ?? order.totals,
    grades: changes.grades ?? order.grades,
    priorGrades: changes.priorGrades ?? order.priorGrades ?? {},
    served: changes.served ?? order.served ?? [],
    toldRapid: changes.toldRapid ?? order.toldRapid ?? false,
  });
}

/**
 * Wrong-answer counts for the items graded so far this sitting, keyed by
 * assignment id. They live here for the same reason the session totals do:
 * this file already defines what "this sitting" means, and the alternative is
 * arithmetic carried across a dozen chat turns in someone's head — which is
 * the kind of bookkeeping that belongs in a file rather than a memory.
 */
export async function loadGrades() {
  return (await loadSitting())?.grades ?? {};
}

const gradeFor = (grades, assignmentId) => grades[assignmentId] ?? { wrongMeaning: 0, wrongReading: 0 };

/** What an item is still waiting on, if anything — "reading" or nothing. */
export async function awaitingFor(assignmentId) {
  const grades = await loadGrades();
  return grades[assignmentId]?.awaiting ?? null;
}

/**
 * The finished record for an assignment — answered this batch, waiting on
 * nothing further. Null while the item is still open or hasn't been asked yet.
 *
 * It's the difference between the two follow-up shapes: an open item's next
 * reply is the reading it just asked for, and a settled item has no next
 * reply, because the verdict is already on the record and the correction has
 * already shown the answer.
 */
export async function settledGrade(assignmentId) {
  const grade = (await loadGrades())[assignmentId];
  return !grade || grade.awaiting ? null : grade;
}

/**
 * Adds one attempt's misses to an assignment's running record, and remembers
 * what the item is still waiting on. That last part matters: an item that
 * asked "Reading?" and then got one bare word back was reading it as a
 * *meaning* and closing the item as a double miss — a right answer, scored
 * as two wrong ones.
 */
export async function recordGrade(assignmentId, { wrongMeaning = 0, wrongReading = 0, awaiting = null }) {
  const order = await loadSitting();
  if (!order) return null;

  const grades = { ...(order.grades ?? {}) };
  const current = gradeFor(grades, assignmentId);
  grades[assignmentId] = {
    wrongMeaning: current.wrongMeaning + wrongMeaning,
    wrongReading: current.wrongReading + wrongReading,
    ...(awaiting ? { awaiting } : {}),
  };
  await rewrite(order, { grades });
  return grades[assignmentId];
}

/**
 * Hands a batch out: these are the items now being asked, in the order they
 * were asked, and nothing recorded against them earlier counts any more.
 *
 * The forgetting half is because asking an item supersedes any earlier attempt
 * at it — a record kept across the re-ask is a record of answers nobody gave
 * this time, and one left over from an abandoned sitting was submitted an hour
 * later against a batch the user had just answered correctly, demoting four
 * items for it.
 *
 * The remembering half is what makes "the batch" a thing the CLI knows rather
 * than a thing the caller holds in its head: the sitting's `items` run to
 * however many hundred are due, so without this there's no way to ask which of
 * *these ten* are still unanswered.
 */
export async function beginBatch(assignmentIds) {
  const order = await loadSitting();
  if (!order) return null;

  const asked = new Set(assignmentIds);
  const [cleared, grades] = partition(order.grades ?? {}, (assignmentId) => asked.has(assignmentId));
  await rewrite(order, {
    grades,
    priorGrades: carryMisses(order.priorGrades ?? {}, cleared),
    served: [...assignmentIds],
  });
  return grades;
}

/** Splits a grade record in two by assignment id: [matching, rest]. */
function partition(grades, predicate) {
  const matching = {};
  const rest = {};
  for (const [assignmentId, counts] of Object.entries(grades)) {
    (predicate(Number(assignmentId)) ? matching : rest)[assignmentId] = counts;
  }
  return [matching, rest];
}

/**
 * What an item got wrong *earlier in this sitting*, kept when the record for
 * it is cleared. Only the misses: a clean attempt leaves nothing to carry.
 *
 * The clearing is right — the answers being graded now are the ones being
 * given now — but "you never missed this today" is a different claim, and a
 * false one. A session that had lost its record replayed the sitting from the
 * chat log, which by then held the answers *it* had supplied after each miss;
 * thirty items went in as thirty perfect scores, fourteen of them missed
 * minutes earlier, and four of those were burned out of the review cycle
 * on the strength of it. `submit-batch` adds these back, so a re-ask can
 * change what the user is asked and never how well they did.
 */
function carryMisses(carried, cleared) {
  const result = { ...carried };
  for (const [assignmentId, counts] of Object.entries(cleared)) {
    const prior = result[assignmentId] ?? { wrongMeaning: 0, wrongReading: 0 };
    const wrongMeaning = prior.wrongMeaning + (counts.wrongMeaning ?? 0);
    const wrongReading = prior.wrongReading + (counts.wrongReading ?? 0);
    if (wrongMeaning + wrongReading > 0) result[assignmentId] = { wrongMeaning, wrongReading };
  }
  return result;
}

/**
 * Misses carried over from earlier attempts at items in this sitting, keyed by
 * assignment id. Empty for a sitting where nothing has been re-asked.
 */
export async function loadPriorGrades() {
  return (await loadSitting())?.priorGrades ?? {};
}

/**
 * Whether the how-to for answering a whole list has been said in this sitting,
 * and saying it. Once is the rule, the same as the answer convention's: it's
 * the line that makes the reply parseable the first time someone sees a list,
 * and dead weight under every list after that.
 */
export async function rapidExplained() {
  const order = await loadSitting();
  if (!order || order.toldRapid) return true;
  await rewrite(order, { toldRapid: true });
  return false;
}

/**
 * The items in the current batch that are still waiting on an answer, in the
 * order they were asked and carrying the number they were asked under — the
 * ones never answered, plus the ones a re-prompt left open.
 *
 * Null means there's no batch on record at all (nothing served, or the sitting
 * is gone); an empty array means the batch is answered and due to be
 * submitted. The two are different things to say, so they're different values.
 */
export async function openItems() {
  const order = await loadSitting();
  const served = order?.served;
  if (!Array.isArray(served) || served.length === 0) return null;

  const subjectIds = new Map(order.items.map((item) => [item.assignmentId, item.subjectId]));
  const grades = order.grades ?? {};

  return served
    .map((assignmentId, index) => ({
      position: index + 1,
      assignmentId,
      subjectId: subjectIds.get(assignmentId) ?? null,
      grade: grades[assignmentId] ?? null,
    }))
    .filter((entry) => entry.subjectId !== null && (!entry.grade || entry.grade.awaiting))
    .map(({ grade, ...entry }) => ({ ...entry, awaiting: grade?.awaiting ?? null }));
}

/**
 * The furthest-along item this batch has finished with — the one whose verdict
 * was just printed.
 *
 * It lived in `session.js`, where `--forgive` needed "the item just graded".
 * `explain` needs the same item for the same reason: bare, with nothing after
 * it, that is what "this one" means once a verdict is on screen.
 */
export async function lastSettledItem() {
  const order = await loadSitting();
  const served = order?.served;
  if (!Array.isArray(served)) return null;

  const grades = order.grades ?? {};
  const subjectIds = new Map(order.items.map((item) => [item.assignmentId, item.subjectId]));
  for (let index = served.length - 1; index >= 0; index -= 1) {
    const assignmentId = served[index];
    const grade = grades[assignmentId];
    if (grade && !grade.awaiting && subjectIds.has(assignmentId)) {
      return { assignmentId, subjectId: subjectIds.get(assignmentId), position: index + 1 };
    }
  }
  return null;
}

/**
 * Takes one miss back off the record — the override case, where the answer
 * key said no and a human (or a reasonable reading of a typo) said yes.
 * Floors at zero, so forgiving more than was recorded is harmless.
 */
export async function forgiveGrade(assignmentId, part) {
  const order = await loadSitting();
  // No assignment means the item isn't in this sitting, so there's nothing on
  // the record to take off — and inventing a `grades[null]` for it puts a NaN
  // assignment id in front of `submit-batch`.
  if (!order || !assignmentId) return null;

  const grades = { ...(order.grades ?? {}) };
  const current = gradeFor(grades, assignmentId);
  const key = part === "reading" ? "wrongReading" : "wrongMeaning";
  grades[assignmentId] = { ...current, [key]: Math.max(0, current[key] - 1) };
  await rewrite(order, { grades });
  return grades[assignmentId];
}

/**
 * Running totals for the current sitting. They live alongside the queue order
 * because it already defines what "this session" means — one live fetch, aged
 * out after 30 minutes — which saves the caller from carrying the arithmetic
 * across batches in its head.
 */
export async function addSessionTotals({ submitted = 0, perfect = 0 }) {
  const order = await loadSitting();
  if (!order) return null;

  const totals = {
    submitted: (order.totals?.submitted ?? 0) + submitted,
    perfect: (order.totals?.perfect ?? 0) + perfect,
  };
  await rewrite(order, { totals });
  return totals;
}

/**
 * Removes just-submitted assignments from the pending order, so the next
 * batch picks up where this one left off. Items answered but never submitted
 * (an interrupted session) stay put and come back around, which is the
 * behaviour to protect: skipping them silently would lose the user's place.
 *
 * Keeps the original `fetchedAt` so a long session still ages out on schedule.
 * Returns the number of items left, or null if there was no live order.
 */
export async function dropFromQueueOrder(assignmentIds) {
  const order = await loadSitting();
  if (!order) return null;

  const submitted = new Set(assignmentIds);
  const items = order.items.filter((item) => !submitted.has(item.assignmentId));
  // A submitted item's counts have done their job; leaving them would double
  // them onto the next `submit-batch --graded`.
  const grades = Object.fromEntries(
    Object.entries(order.grades ?? {}).filter(([assignmentId]) => !submitted.has(Number(assignmentId))),
  );
  // Same for the batch it was part of: submitting is the end of that batch, so
  // what's left of `served` is whatever went unanswered, and the next `queue`
  // hands those back out at the top of a new one.
  const served = (order.served ?? []).filter((assignmentId) => !submitted.has(assignmentId));
  // Carried misses are spent by the same submission that used them.
  const [, priorGrades] = partition(order.priorGrades ?? {}, (assignmentId) => submitted.has(assignmentId));
  await rewrite(order, { items, grades, priorGrades, served });
  return items.length;
}
