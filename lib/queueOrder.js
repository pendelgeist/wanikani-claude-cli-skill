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
  await saveQueueOrder(order.items, order.fetchedAt, order.totals, order.grades);
  return true;
}

export async function saveQueueOrder(
  items,
  fetchedAt = new Date().toISOString(),
  totals = { submitted: 0, perfect: 0 },
  grades = {},
) {
  await writeJsonCache(ORDER_FILE, {
    fetchedAt,
    touchedAt: new Date().toISOString(),
    items,
    totals,
    grades,
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
  await saveQueueOrder(order.items, order.fetchedAt, order.totals, grades);
  return grades[assignmentId];
}

/**
 * Forgets whatever was recorded for these assignments. Asking an item
 * supersedes any earlier attempt at it: a record kept across the re-ask is a
 * record of answers nobody gave this time. One left over from an abandoned
 * sitting was submitted an hour later against a batch the user had just
 * answered correctly, and demoted four items for it.
 */
export async function clearGradesFor(assignmentIds) {
  const order = await loadSitting();
  if (!order) return null;

  const asked = new Set(assignmentIds);
  const grades = Object.fromEntries(
    Object.entries(order.grades ?? {}).filter(([assignmentId]) => !asked.has(Number(assignmentId))),
  );
  await saveQueueOrder(order.items, order.fetchedAt, order.totals, grades);
  return grades;
}

/**
 * Takes one miss back off the record — the override case, where the answer
 * key said no and a human (or a reasonable reading of a typo) said yes.
 * Floors at zero, so forgiving more than was recorded is harmless.
 */
export async function forgiveGrade(assignmentId, part) {
  const order = await loadSitting();
  if (!order) return null;

  const grades = { ...(order.grades ?? {}) };
  const current = gradeFor(grades, assignmentId);
  const key = part === "reading" ? "wrongReading" : "wrongMeaning";
  grades[assignmentId] = { ...current, [key]: Math.max(0, current[key] - 1) };
  await saveQueueOrder(order.items, order.fetchedAt, order.totals, grades);
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
  await saveQueueOrder(order.items, order.fetchedAt, totals, order.grades);
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
  await saveQueueOrder(items, order.fetchedAt, order.totals, grades);
  return items.length;
}
