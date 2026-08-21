# wanikani-cli

[![test](https://github.com/pendelgeist/wanikani-claude-cli-skill/actions/workflows/test.yml/badge.svg)](https://github.com/pendelgeist/wanikani-claude-cli-skill/actions/workflows/test.yml)

Do your [WaniKani](https://www.wanikani.com/) reviews from the terminal
instead of the web app — either as a plain Node CLI, or as a Claude Code skill
that drives the quiz conversationally.

**Reviews only.** Lessons are done on wanikani.com; there's no command for them
here, deliberately (see [Scope](#scope)).

Driven by Claude, a sitting is two commands in a loop, and the CLI prints
every line of it:

```
$ wanikani ask
Meaning and reading together on one line — e.g. "fur, ke" — and I'll grade both.
Say "more" after an item for its mnemonic and parts, or "what can I say?" for the rest.

1. 力

$ wanikani answer "power ryoku"
✓

2. 上

$ wanikani answer "above shou"
✗ reading is じょう (on'yomi) · https://jisho.org/search/%E4%B8%8A%20%23kanji
(recorded — next item)

3. 出る
```

You type the answers; Claude runs the commands and prints what they say.
Grading, the batch, and when to submit belong to the CLI rather than to the
model — [why](docs/design.md).

## Install

```
npm install
npm link                     # puts `wanikani` on your $PATH
```

Then get an API token — [Settings → API Tokens](https://www.wanikani.com/settings/personal_access_tokens)
on wanikani.com — and either `export WANIKANI_API_TOKEN=…` or copy
`.env.example` to `.env` and paste it in. The CLI reads that `.env` from the
repo whatever directory you run it in.

Reviews need **`reviews:create`** checked — that's the only write this tool
does. Nothing here uses `assignments:start`, `study_materials:*` or
`user:update`. Check it works:

```
wanikani summary
```

**To use it from Claude Code**, link the skill where Claude Code looks, then
restart it and say `/wanikani`:

```
ln -s "$PWD/.claude/skills/wanikani" ~/.claude/skills/wanikani
```

Symlink it rather than copying it — a copy silently goes stale, and a session
running last month's instructions looks completely normal from the outside.

## Usage

**With Claude** — you answer, it runs the two commands and prints what they
say. Nothing else to learn; the example at the top is the whole loop. Mid-
sitting you can also say:

| Say | What happens |
| --- | --- |
| "more", "why", a bare "?" | The full entry for the item just graded — mnemonics, parts, other readings |
| "rapid fire" | The rest of the batch as one list, answered in one message separated by `\|`. "one at a time" goes back |
| "did that go through?" | Reads the local record rather than counting back through the chat |
| "stop" | Sends what you've answered; the rest stays due |
| "drill my recent mistakes" | Re-asks what you last got wrong. Nothing is due and nothing submits |
| "critical items" | The items WaniKani has you under 75% correct on — its own critical-condition list, worst first. Same terms as a drill |
| "what can I say?" | The whole list, from the CLI itself |

Never paste your API token into the chat — the skill reads it from the
environment or `.env` precisely so it never lands in a transcript.

**Without Claude** — `wanikani review` is a full interactive session in the
terminal:

```
wanikani summary          # level, reviews due now, next review time
wanikani review           # interactive review session
wanikani review --limit 10
```

It quizzes meaning (and reading, for kanji and vocabulary), takes kana or
romaji, and accepts both halves on one line in either order. `:show` reveals
an answer, `:quit` stops early — anything already answered is submitted as you
go, so nothing done is lost.

### Drills

Two commands ask questions that aren't reviews. Neither is due, neither
submits, and nothing either one does reaches your WaniKani account — so they
cost nothing and can be run mid-sitting or on their own. Say "drill my recent
mistakes" or "critical items" and Claude picks the right one; on the terminal
they're `drill` and `critical-condition`.

They differ in what they know:

| | Where the list comes from | What's on it |
| --- | --- | --- |
| `drill` | This tool's own record of your sittings | What you got wrong recently — nothing on a fresh install, and nothing you reviewed on the website |
| `critical-condition` | WaniKani's records, live | Every item it has you under 75% correct on, over your whole history with the item, wherever you reviewed it |

So `critical-condition` is the wider net, and it's the same list
[wanikani.com/critical-items](https://www.wanikani.com/critical-items) shows:

```
$ wanikani critical-condition --limit 3
[
  { "subjectId": 440, "prompt": "1. 育", "percentageCorrect": 50, ... },
  { "subjectId": 600, "prompt": "2. 放", "percentageCorrect": 55, ... },
  { "subjectId": 2801, "prompt": "3. 苦労", "percentageCorrect": 67, ... }
]
```

It's ten items unless you say otherwise, and the payload says how many more
there are. `--under 60` draws the line somewhere tighter than WaniKani's 75%.
Burned items stay in — an item you burned and still get wrong is exactly what
the list is for, and nothing schedules it any more. Retired subjects don't:
they can't come up again, so their percentage is nobody's problem.

## Upgrading

```
wanikani update
```

Pulls this repo from wherever you ran it, names what came in, and says whether
the change is live already or wants a Claude Code restart.

<details>
<summary>Coming from an install that predates the symlink</summary>

Older installs have a *copy* of the skill at `~/.claude/skills/wanikani/`,
usually with absolute paths hand-edited into it — which is what made it a copy
rather than a link, and what stops it ever being re-copied over. One ran four
releases behind for three weeks, driving sittings with commands that no longer
existed, and nothing about it looked wrong.

To tell which you have:

```
ls -l ~/.claude/skills/wanikani     # an arrow to this repo means you're fine
grep -c "queue --limit 10" ~/.claude/skills/wanikani/SKILL.md
```

A match on the second means you're on a pre-`ask`/`answer` version. Migrate
once:

```
cd /path/to/wanikani-claude-cli-skill
git pull && npm install && npm link
rm -rf ~/.claude/skills/wanikani
ln -s "$PWD/.claude/skills/wanikani" ~/.claude/skills/wanikani
```

Restart Claude Code, then check it took: a sitting should open with
`wanikani ask`, not `wanikani queue --limit 10`. After that `wanikani update`
is the whole story.

Nothing in your WaniKani account needs migrating — the CLI keeps no state
beyond a cache you can delete, and every version submits the same reviews the
website does.

</details>

## Commands

| Command | Purpose |
| --- | --- |
| `summary [--json]` | Level, reviews available, next review time. Reports the lesson count too, and says where lessons get done |
| `review [--limit N]` | Full interactive review session |
| `ask [--limit N]` | The question that's waiting, printed: fetches a batch when there isn't one, re-asks the open item when there is, submits a finished batch before serving the next. Batches are ten unless you say otherwise |
| `answer "<your whole reply>" [--forgive meaning\|reading]` | Grade that reply against whatever is open, then print the verdict and the next question. No id: the record knows which item is open. `--forgive` takes the last verdict back |
| `queue [--limit N] [--answers] [--restart]` | Due reviews as JSON: questions and ids, no answers. Refuses while answers are graded and unsubmitted; `--restart` discards them deliberately, `--answers` restores the key for debugging |
| `drill [--limit N]` | The items answered wrong recently, as questions — same shape as `queue`. Nothing in it is due and nothing submits |
| `critical-condition [--limit N] [--under P]`<br>(or `critical`) | The critical-condition list wanikani.com shows: every item WaniKani has you under 75% correct on, worst first. Same shape and terms as `drill`; `--under` moves the line |
| `prompts` | The still-unanswered questions in the current batch, as one block to print — the rapid-fire list |
| `grade <subjectId> "<answer>" [--meaning M] [--reading R] [--forgive meaning\|reading]` | The same grading with the item named explicitly — what `drill` and rapid-fire use, and what `answer` calls underneath |
| `grade-many "<a> \| <b> \| ..."` | Grade a batch answered in one message, in the order `prompts` listed it. Blanks stay open; more answers than open items is refused rather than misaligned |
| `explain [<id\|characters>] [--json]` | Everything WaniKani teaches about one item — mnemonics, hints, what it's built from. Bare, it's the item that's open |
| `status [--json]` | What the current sitting's record holds: how much of the batch is answered, how much is waiting to be sent, and the next call to make (no token needed) |
| `tips` | Everything you can say during a session, all at once (no token needed) |
| `update` | Pull this repo from wherever you ran it, and say whether the change is live already or wants a Claude Code restart (no token needed) |
| `submit <assignmentId> [--wrong-meaning N] [--wrong-reading N]` | Submit one graded review |
| `submit-batch` | Send everything graded this batch, in one call. Works on a part-answered batch too: what's answered goes, the rest stays due — which is what to run when you stop early |

## Scope

Reviews, and the things that support them: `summary`, `explain`, `status`,
`drill`, `critical-condition`, `tips`, `update`.

**Lessons aren't here.** `lessons` and `start` existed, were never once used,
and were removed rather than left to rot — an untested path that writes to
your WaniKani account is worse than no path at all, and the Claude-driven
teaching flow behind them had never run either. `summary` still tells you how
many are waiting; do them on wanikani.com, where they'll also be taught better
than this could. The token no longer needs `assignments:start`.

If you want them back, they're in the history — `git log -- lib/commands/lessons.js`.

## Reference

- [How grading works](docs/grading.md) — what counts as a right answer, and
  why each allowance is there.
- [Why it's shaped this way](docs/design.md) — what the CLI decides instead of
  the model, what it hands back, and how the cache works.
- [`SKILL.md`](.claude/skills/wanikani/SKILL.md) — the instructions Claude
  actually runs on, and [`FAILURES.md`](.claude/skills/wanikani/FAILURES.md)
  beside it, which is what each rule cost before it was a rule.

## Tests

```
npm test
```

Node's built-in runner, no test framework — there's no linter or formatter in
the project, so `npm test` is the whole check. The WaniKani API is stubbed
throughout and never called; anything that writes is pointed at a temp
directory, including the `update` tests, which drive a real `git` against
throwaway clones. So it runs offline in well under a minute. CI runs it on
Node 20.12 (the floor `engines` declares), 22, and 24.

## Claude Code on the web

`.claude/hooks/session-start.sh` runs `npm install` when a session starts in
a remote environment, which begins from a fresh clone with no `node_modules`
— without it the CLI can't run and `npm test` fails at import. It's a no-op
locally (gated on `CLAUDE_CODE_REMOTE`) and safe to re-run.

## Notes

- Talks directly to `https://api.wanikani.com/v2`; see WaniKani's
  [API docs](https://docs.api.wanikani.com/) for the underlying resources.
- Respects the 60-requests/minute rate limit by waiting for the reset the
  API reports on an HTTP 429. Failed GETs are retried with backoff; writes
  (`POST /reviews`) are never replayed, since a request that timed out may
  still have landed.
- `ask` and `review` do real writes to your WaniKani account (SRS progress)
  — there's no dry-run mode.
