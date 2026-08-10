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

export async function saveQueueOrder(items, fetchedAt = new Date().toISOString(), totals = { submitted: 0, perfect: 0 }) {
  await writeJsonCache(ORDER_FILE, { fetchedAt, items, totals });
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
  await saveQueueOrder(order.items, order.fetchedAt, totals);
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
  await saveQueueOrder(items, order.fetchedAt, order.totals);
  return items.length;
}
