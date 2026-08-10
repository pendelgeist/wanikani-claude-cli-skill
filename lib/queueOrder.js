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

export async function saveQueueOrder(items, fetchedAt = new Date().toISOString()) {
  await writeJsonCache(ORDER_FILE, { fetchedAt, items });
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
  await saveQueueOrder(items, order.fetchedAt);
  return items.length;
}
