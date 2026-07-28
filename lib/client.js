const API_ROOT = "https://api.wanikani.com/v2";
const REVISION = process.env.WANIKANI_REVISION || "20170710";

export class WaniKaniError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "WaniKaniError";
    this.status = status;
  }
}

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

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429 && attempt === 0) {
        const resetAt = Number(res.headers.get("RateLimit-Reset")) * 1000;
        const waitMs = Math.max(0, resetAt - Date.now()) || 5000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (res.status === 204) return null;

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message = json?.error || res.statusText;
        throw new WaniKaniError(`${res.status} ${message}`, res.status);
      }
      return json;
    }
    throw new WaniKaniError("Rate limited twice in a row, giving up.", 429);
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
