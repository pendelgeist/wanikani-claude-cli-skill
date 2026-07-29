# wanikani-cli

Do your [WaniKani](https://www.wanikani.com/) lessons and reviews from the
terminal instead of the web app — either as a plain Node CLI, or as a Claude
Code skill that drives the quiz conversationally.

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Get an API token: sign in at [wanikani.com/dashboard](https://www.wanikani.com/dashboard),
   then go to [Settings → API Tokens](https://www.wanikani.com/settings/personal_access_tokens)
   → "Create a Personal Access Token". Every token gets read access to
   `summary`/`lessons`/`queue` for free — only check boxes for the write
   access this tool actually uses:

   | Permission | Needed for |
   | --- | --- |
   | `assignments:start` | `lessons --start` |
   | `reviews:create` | `review`, `submit`, `submit-batch` |

   Leave `study_materials:*` and `user:update` unchecked — nothing here uses
   them. If you'll only ever run `summary`/`queue`/`lessons` (no `--start`,
   `review`, or `submit`), skip checking anything and generate a read-only
   token.

3. Make the token available to the CLI — either:

   ```
   export WANIKANI_API_TOKEN=...
   ```

   or copy `.env.example` to `.env`, paste the token in, and run commands
   with `node --env-file=.env bin/wanikani.js ...`.

4. Confirm it works:

   ```
   node bin/wanikani.js summary
   ```

## Usage (plain CLI)

```
node bin/wanikani.js summary          # level, lessons/reviews due, next review time
node bin/wanikani.js lessons          # show available lessons + mnemonics
node bin/wanikani.js lessons --start  # ...and prompt to mark each one started
node bin/wanikani.js review           # interactive review session
node bin/wanikani.js review --limit 10
```

`review` quizzes meaning (and reading, for kanji/vocabulary), accepting kana
or romaji for readings. Type `:show` to reveal an answer or `:quit` to stop
early — items already answered are submitted immediately, so nothing already
done is lost.

Optionally `npm link` to get a `wanikani` command on your `$PATH`.

## Usage (as a Claude Code skill)

Open this repo in Claude Code and ask it to do your WaniKani reviews (or use
`/wanikani` if it's registered as a slash command). See
[`.claude/skills/wanikani/SKILL.md`](.claude/skills/wanikani/SKILL.md) for
what it does: it calls `wanikani queue --limit 10` to get a batch of due
reviews with their answer keys, quizzes you in chat using its own judgment on
typos/phrasing (more forgiving than the plain CLI's exact matching), then
submits the whole batch in one `wanikani submit-batch` call before fetching
the next 10 — so a 600-review session is a couple dozen tool calls, not
hundreds. You can answer meaning and reading together in one line (e.g.
"fur, ke"), it auto-advances to the next item without needing you to say
"next", and it links out to [Jisho](https://jisho.org/) on anything you get
wrong so you can dig into it right away.

Never paste your API token into the chat — the skill is instructed to read
it from your shell environment or a local `.env` file instead, precisely so
it never ends up typed into a command (and therefore into a transcript).

## How grading works

- **Meaning**: case/whitespace-insensitive match against the subject's
  accepted meanings plus whitelisted auxiliary meanings; blacklisted
  auxiliary meanings (things that look right but aren't) are always rejected.
- **Reading**: romaji input is converted to kana (via
  [wanakana](https://www.npmjs.com/package/wanakana)) before matching against
  the subject's accepted readings.

See `lib/grading.js` (unit tested in `test/grading.test.js`).

## Commands reference

| Command | Purpose |
| --- | --- |
| `summary [--json]` | Level, lessons/reviews available, next review time |
| `lessons [--start]` | List available lessons; `--start` prompts to mark each started (needs a TTY) |
| `review [--limit N]` | Full interactive review session |
| `queue [--limit N]` | Due reviews as JSON, including answer keys — for the Claude skill |
| `submit <assignmentId> [--wrong-meaning N] [--wrong-reading N]` | Submit one graded review |
| `submit-batch` | Submit several graded reviews in one call — reads a JSON array of `{assignmentId, wrongMeaning, wrongReading}` from stdin |

## Caching

Subject content (characters, meanings, readings, mnemonics) is cached
locally at `~/.cache/wanikani-cli/subjects.json` the first time each subject
is fetched — WaniKani's own docs recommend caching subjects aggressively
since they rarely change. There's no TTL/expiry; if a subject's content
ever changes upstream and you want fresh data, delete that file (or point
`WANIKANI_CACHE_DIR` at an empty directory). Nothing else is cached —
assignments, reviews, and summary data are always fetched live since they
change constantly.

## Notes

- Talks directly to `https://api.wanikani.com/v2`; see WaniKani's
  [API docs](https://docs.api.wanikani.com/) for the underlying resources.
- Respects the 60-requests/minute rate limit with a single retry-after-reset
  backoff on HTTP 429.
- `review`/`lessons --start` do real writes to your WaniKani account (SRS
  progress, lesson start times) — there's no dry-run mode.
