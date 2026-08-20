import { test } from "node:test";
import assert from "node:assert/strict";
import { WaniKaniClient, WaniKaniError } from "../lib/client.js";

function fakeResponse({ status = 200, body = {}, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "Error",
    headers: { get: (name) => headers[name] ?? null },
    async json() {
      return body;
    },
  };
}

/** Swaps in a scripted fetch; each entry is a response or a thrown error. */
async function withFetch(script, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** A RateLimit-Reset header `ms` in the future, so the wait it implies stays test-sized. */
const resetInMs = (ms) => String((Date.now() + ms) / 1000);

const client = new WaniKaniClient("test-token");

test("constructor rejects a missing token", () => {
  assert.throws(() => new WaniKaniClient(undefined), WaniKaniError);
});

test("request retries a 429 once the rate limit resets", async () => {
  const script = [
    fakeResponse({ status: 429, headers: { "RateLimit-Reset": resetInMs(50) } }),
    fakeResponse({ body: { data: "ok" } }),
  ];

  await withFetch(script, async (calls) => {
    const result = await client.request("/user");
    assert.equal(result.data, "ok");
    assert.equal(calls.length, 2);
  });
});

test("request retries a 5xx on GET", async () => {
  await withFetch([fakeResponse({ status: 503 }), fakeResponse({ body: { data: "ok" } })], async (calls) => {
    const result = await client.request("/user");
    assert.equal(result.data, "ok");
    assert.equal(calls.length, 2);
  });
});

test("request does not replay a failed POST — that could double-submit a review", async () => {
  await withFetch([fakeResponse({ status: 503, body: { error: "upstream" } })], async (calls) => {
    await assert.rejects(
      () => client.submitReview({ assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 }),
      /503/,
    );
    assert.equal(calls.length, 1);
  });
});

test("request retries a network error on GET but not on POST", async () => {
  await withFetch([new Error("ECONNRESET"), fakeResponse({ body: { data: "ok" } })], async (calls) => {
    assert.equal((await client.request("/user")).data, "ok");
    assert.equal(calls.length, 2);
  });

  await withFetch([new Error("ECONNRESET")], async (calls) => {
    await assert.rejects(
      () => client.submitReview({ assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 }),
      /Could not reach WaniKani/,
    );
    assert.equal(calls.length, 1);
  });
});

test("request gives up after the attempt budget instead of looping forever", async () => {
  const rateLimited = () => fakeResponse({ status: 429, headers: { "RateLimit-Reset": resetInMs(50) } });

  await withFetch([rateLimited(), rateLimited(), rateLimited()], async (calls) => {
    await assert.rejects(() => client.request("/user"), /429/);
    assert.equal(calls.length, 3);
  });
});

test("a 403 names the one permission the failed call needed", async () => {
  await withFetch([fakeResponse({ status: 403, body: { error: "Forbidden" } })], async () => {
    await assert.rejects(
      () => client.submitReview({ assignmentId: 1, incorrectMeaningAnswers: 0, incorrectReadingAnswers: 0 }),
      /needs the token's reviews:create permission/,
    );
  });

  await withFetch([fakeResponse({ status: 403, body: { error: "Forbidden" } })], async () => {
  });

  // A read call has no box to tick, so it points at the settings page instead
  // of naming a permission it can't know.
  await withFetch([fakeResponse({ status: 403, body: { error: "Forbidden" } })], async () => {
    await assert.rejects(() => client.getUser(), /check the token's permissions/);
  });
});

test("a missing token says how to supply one", () => {
  assert.throws(() => new WaniKaniClient(undefined), /Copy \.env\.example to \.env/);
});

test("request returns null for 204 without parsing a body", async () => {
  await withFetch([fakeResponse({ status: 204 })], async () => {
    assert.equal(await client.request("/assignments/1/start", { method: "PUT" }), null);
  });
});

test("getCollection follows pagination until next_url runs out", async () => {
  const script = [
    fakeResponse({ body: { data: [1, 2], pages: { next_url: "https://api.wanikani.com/v2/assignments?page=2" } } }),
    fakeResponse({ body: { data: [3], pages: { next_url: null } } }),
  ];

  await withFetch(script, async (calls) => {
    const items = await client.getAssignments({ immediately_available_for_review: true });
    assert.deepEqual(items, [1, 2, 3]);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /immediately_available_for_review=true/);
    assert.equal(calls[1].url, "https://api.wanikani.com/v2/assignments?page=2");
  });
});

test("getSubjectsUpdatedAfter asks for just the changed subjects", async () => {
  await withFetch([fakeResponse({ body: { data: [], pages: { next_url: null } } })], async (calls) => {
    await client.getSubjectsUpdatedAfter("2026-01-01T00:00:00.000Z");
    assert.match(calls[0].url, /\/subjects\?updated_after=2026-01-01/);
  });
});
