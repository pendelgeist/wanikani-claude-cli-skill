# wanikani-cli

Do your [WaniKani](https://www.wanikani.com/) lessons and reviews from the
terminal instead of the web app — either as a plain Node CLI, or as a Claude
Code skill that drives the quiz conversationally.

## Setup

```
npm install
```

Create a token at wanikani.com → Settings → API Tokens → "Create a Personal
Access Token". All tokens get read access to every `GET` endpoint (that
covers `summary`, `lessons`, and `queue`) — you only need to check boxes for
write access this tool actually uses:

- **`assignments:start`** — required for `lessons --start` (marks a lesson
  as started, moving it into the review queue)
- **`reviews:create`** — required for `review` and `submit` (records review
  results, advancing SRS stages)

Leave `study_materials:create`, `study_materials:update`, and `user:update`
unchecked — nothing in this repo uses them. If you only ever plan to run
`summary`/`queue`/`lessons` (no `--start`) and never `review`/`submit`, you
can leave every box unchecked and generate a read-only token instead.

Then:

```
export WANIKANI_API_TOKEN=...
```

(Or copy `.env.example` to `.env`, fill in the token, and run commands with
`node --env-file=.env bin/wanikani.js ...`.)

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
what it does: it calls `wanikani queue` to get due reviews with their answer
keys, quizzes you in chat using its own judgment on typos/phrasing (more
forgiving than the plain CLI's exact matching), and calls `wanikani submit`
per item as you go.

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

## Notes

- Talks directly to `https://api.wanikani.com/v2`; see WaniKani's
  [API docs](https://docs.api.wanikani.com/) for the underlying resources.
- Respects the 60-requests/minute rate limit with a single retry-after-reset
  backoff on HTTP 429.
- `review`/`lessons --start` do real writes to your WaniKani account (SRS
  progress, lesson start times) — there's no dry-run mode.
