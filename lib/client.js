const API_ROOT = "https://api.wanikani.com/v2";
const REVISION = process.env.WANIKANI_REVISION || "20170710";

const MAX_ATTEMPTS = 3;
// A bogus/absent RateLimit-Reset shouldn't be able to park the CLI for hours.
const MAX_RATE_LIMIT_WAIT_MS = 60_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 5_000;

export class WaniKaniError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "WaniKaniError";
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rateLimitWaitMs(res) {
  const resetAt = Number(res.headers.get("RateLimit-Reset")) * 1000;
  const waitMs = resetAt - Date.now();
  if (!Number.isFinite(waitMs) || waitMs <= 0) return DEFAULT_RATE_LIMIT_WAIT_MS;
  return Math.min(waitMs, MAX_RATE_LIMIT_WAIT_MS);
}

const backoffMs = (attempt) => 500 * 2 ** (attempt - 1);

export class WaniKaniClient {
  constructor(token) {
    if (!token) {
      throw new WaniKaniError(
        "No API token found. Set WANIKANI_API_TOKEN (Settings → API Tokens on wanikani.com).",
      );
    }
    this.token = token;
  }

  async request(path, { method = "GET", body } = {}) {
    const url = path.startsWith("http") ? path : `${API_ROOT}${path}`;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      "Wanikani-Revision": REVISION,
    };
    if (body) headers["Content-Type"] = "application/json; charset=utf-8";

    for (let attempt = 1; ; attempt++) {
      const lastAttempt = attempt >= MAX_ATTEMPTS;
      let res;

      try {
        res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        // A dropped connection may still have been processed server-side, so
        // replaying a POST could double-submit a review. Only GETs are safe.
        if (lastAttempt || method !== "GET") {
          throw new WaniKaniError(`Could not reach WaniKani: ${err.message}`);
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      // 429 means the request was rejected outright, so replaying it is safe
      // whatever the method.
      if (res.status === 429 && !lastAttempt) {
        await sleep(rateLimitWaitMs(res));
        continue;
      }

      if (res.status >= 500 && !lastAttempt && method === "GET") {
        await sleep(backoffMs(attempt));
        continue;
      }

      if (res.status === 204) return null;

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        let message = `${res.status} ${json?.error || res.statusText}`;
        if (res.status === 403) {
          message +=
            " — check the token's permissions (reviews:create to submit reviews, assignments:start for lessons --start)";
        }
        throw new WaniKaniError(message, res.status);
      }
      return json;
    }
  }

  /** Follows pages.next_url until exhausted, returning the flattened `data` array. */
  async getCollection(path) {
    let items = [];
    let next = path;
    while (next) {
      const page = await this.request(next);
      items = items.concat(page.data);
      next = page.pages?.next_url ?? null;
    }
    return items;
  }

  getUser() {
    return this.request("/user");
  }

  getSummary() {
    return this.request("/summary");
  }

  getAssignments(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.getCollection(`/assignments${qs ? `?${qs}` : ""}`);
  }

  /** Subjects endpoint filters by ids, chunked to keep query strings reasonable. */
  async getSubjectsByIds(ids) {
    const chunkSize = 300;
    const bySubjectId = new Map();
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const qs = new URLSearchParams({ ids: chunk.join(",") }).toString();
      const items = await this.getCollection(`/subjects?${qs}`);
      for (const item of items) bySubjectId.set(item.id, item);
    }
    return bySubjectId;
  }

  /**
   * Subjects by slug — for kanji and vocabulary that's the characters
   * themselves, which is how a human names an item ("more on 親") when they
   * have no subject id to hand. A slug can match more than one subject: 親 is
   * both a kanji and a word.
   */
  getSubjectsBySlugs(slugs) {
    const qs = new URLSearchParams({ slugs: slugs.join(",") }).toString();
    return this.getCollection(`/subjects?${qs}`);
  }

  /** Subjects whose content changed since `updatedAfter` — how the cache stays fresh. */
  getSubjectsUpdatedAfter(updatedAfter) {
    const qs = new URLSearchParams({ updated_after: updatedAfter }).toString();
    return this.getCollection(`/subjects?${qs}`);
  }

  startAssignment(assignmentId, startedAt) {
    return this.request(`/assignments/${assignmentId}/start`, {
      method: "PUT",
      body: { assignment: startedAt ? { started_at: startedAt } : {} },
    });
  }

  submitReview({ assignmentId, incorrectMeaningAnswers, incorrectReadingAnswers }) {
    return this.request("/reviews", {
      method: "POST",
      body: {
        review: {
          assignment_id: assignmentId,
          incorrect_meaning_answers: incorrectMeaningAnswers,
          incorrect_reading_answers: incorrectReadingAnswers,
        },
      },
    });
  }
}

export function resolveToken(explicitToken) {
  return explicitToken || process.env.WANIKANI_API_TOKEN;
}
