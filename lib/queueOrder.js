import { readJsonCache, writeJsonCache } from "./cacheStore.js";

const ORDER_FILE = "queue-order.json";

// Long enough to cover a sitting, short enough that reviews unlocking on the
// hour surface on their own rather than waiting for the queue to run dry.
const ORDER_TTL_MS = 30 * 60 * 1000;

/**
 * The shuffled order of everything due, as of one live fetch. Returns
 * `{ fetchedAt, items }` or null when there's nothing usable on disk.
 */
export async function loadQueueOrder() {
  const raw = await readJsonCache(ORDER_FILE);
  if (!raw?.fetchedAt || !Array.isArray(raw.items)) return null;
  if (Date.now() - new Date(raw.fetchedAt).getTime() > ORDER_TTL_MS) return null;
  return raw;
}

export async function saveQueueOrder(
  items,
  fetchedAt = new Date().toISOString(),
  totals = { submitted: 0, perfect: 0 },
  grades = {},
) {
  await writeJsonCache(ORDER_FILE, { fetchedAt, items, totals, grades });
}

/**
 * Wrong-answer counts for the items graded so far this sitting, keyed by
 * assignment id. They live here for the same reason the session totals do:
 * this file already defines what "this sitting" means, and the alternative is
 * arithmetic carried across a dozen chat turns in someone's head — which is
 * the kind of bookkeeping that belongs in a file rather than a memory.
 */
export async function loadGrades() {
  return (await loadQueueOrder())?.grades ?? {};
}

const gradeFor = (grades, assignmentId) => grades[assignmentId] ?? { wrongMeaning: 0, wrongReading: 0 };

/** Adds one attempt's misses to an assignment's running record. */
export async function recordGrade(assignmentId, { wrongMeaning = 0, wrongReading = 0 }) {
  const order = await loadQueueOrder();
  if (!order) return null;

  const grades = { ...(order.grades ?? {}) };
  const current = gradeFor(grades, assignmentId);
  grades[assignmentId] = {
    wrongMeaning: current.wrongMeaning + wrongMeaning,
    wrongReading: current.wrongReading + wrongReading,
  };
  await saveQueueOrder(order.items, order.fetchedAt, order.totals, grades);
  return grades[assignmentId];
}

/**
 * Takes one miss back off the record — the override case, where the answer
 * key said no and a human (or a reasonable reading of a typo) said yes.
 * Floors at zero, so forgiving more than was recorded is harmless.
 */
export async function forgiveGrade(assignmentId, part) {
  const order = await loadQueueOrder();
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
  const order = await loadQueueOrder();
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
  const order = await loadQueueOrder();
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
