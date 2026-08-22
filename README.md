# wanikani-cli

[![test](https://github.com/pendelgeist/wanikani-claude-cli-skill/actions/workflows/test.yml/badge.svg)](https://github.com/pendelgeist/wanikani-claude-cli-skill/actions/workflows/test.yml)

Do your [WaniKani](https://www.wanikani.com/) reviews from the terminal — as a
plain Node CLI, or as a [Claude Code](https://claude.com/claude-code) skill
that runs the quiz conversationally. Same reviews, same SRS, submitted to the
same account.

**The model does not grade your answers.** Grading is a lookup table in
`lib/grading.js`: WaniKani's own typo tolerance, its romaji-to-kana
conversion, its rule that another of a kanji's readings re-prompts rather than
counting against you. Claude runs the commands and prints what they say — it
holds no answer key and has nothing to be lenient with. That split is the
whole design, and it's there because every part of it that was once left to
prose eventually got a review wrong. See [why](docs/design.md).

**Reviews only.** Lessons are done on wanikani.com — there is no command for
them here, deliberately ([scope](#scope)).

## What a sitting looks like

You type the answers; Claude runs the two commands and prints what they say.

```
$ wanikani ask
1. 力

Meaning and reading together on one line — e.g. "fur, ke" — and I'll grade both.
Say "more" after an item for its mnemonic and parts, or "what can I say?" for the rest.

$ wanikani answer "power ryoku"
✓

2. 上

$ wanikani answer "above shou"
✗ reading is じょう (on'yomi) · https://jisho.org/search/%E4%B8%8A%20%23kanji
(recorded — next item)

3. 出る
```

Ten items later the batch submits itself and says what it did:

```
$ wanikani ask
10 done, 8 perfect · 上 → Guru · 52 left
```

Mid-batch you can ask for anything WaniKani knows about the item in front of
you — its mnemonic, what it's built from, why the reading isn't the one you
typed — without leaving the flow or handing yourself the answer to something
still open.

## What you need

- **Node 20.12 or newer** (`node --version`).
- **A WaniKani API token** with `reviews:create` — that permission is the only
  write this tool does.
- **Claude Code**, if you want the conversational half. The CLI works on its
  own without it (`wanikani review`).
- A POSIX shell for the install lines below; on Windows, WSL.

## Install

```bash
git clone https://github.com/pendelgeist/wanikani-claude-cli-skill.git
cd wanikani-claude-cli-skill
npm install
npm link                     # puts `wanikani` on your $PATH
```

Get a token from [Settings → API
Tokens](https://www.wanikani.com/settings/personal_access_tokens) on
wanikani.com, tick **`reviews:create`**, and either `export
WANIKANI_API_TOKEN=…` in your shell or copy `.env.example` to `.env` and paste
it in there. The CLI reads that `.env` from the repo whatever directory you run
it in. Check it took:

```bash
wanikani summary
```

**For the Claude Code half**, link the skill where Claude Code looks for it,
restart Claude Code, and say `/wanikani`:

```bash
ln -s "$PWD/.claude/skills/wanikani" ~/.claude/skills/wanikani
```

Symlink rather than copy. A copy silently goes stale, and a session running
last month's instructions looks completely normal from the outside — one ran
four releases behind for three weeks.

## Using it with Claude

Say `/wanikani`, or "do my wanikani reviews". Answer the questions as they come
— meaning and reading on one line, in either order, separated by whatever comes
to hand ("power ryoku", "power, ryoku", "power. ryoku"). Romaji or kana both
work.

Mid-sitting you can also say:

| Say | What happens |
| --- | --- |
| "more", "why", a bare "?" | The full entry for the item — mnemonics, parts, other readings, context sentences |
| "explain 場" | The same for any item you name, whether or not it's in this batch |
| "rapid fire" | The rest of the batch as one list, answered in one message separated by `\|`. "one at a time" goes back |
| "did that go through?" | Reads the local record rather than counting back through the chat |
| "wait", "hold on" | Stops auto-advancing between items for the rest of the sitting |
| "stop" | Sends what you've answered; the rest stays due |
| "drill my recent mistakes" | Re-asks what you last got wrong. Nothing is due and nothing submits |
| "critical items" | The items WaniKani has you under 75% correct on — its own list, worst first. Same terms as a drill |
| "update wanikani" | Pulls the latest version of this repo |
| "what can I say?" | The whole list, printed by the CLI itself |

Two things worth knowing:

- **A miss ends the item.** The correction shows both halves and there is no
  retry offered: WaniKani doesn't offer one either, and after the reveal a
  retry is just typing the answer back off the screen.
- **You can overrule a verdict.** When a wrong answer was plainly a typo, say
  so and Claude runs `answer --forgive meaning` (or `reading`), which takes the
  miss back off the record before the batch is submitted. It's for typos, not
  for synonyms the answer key doesn't list: forgiving a genuinely different
  word puts your record out of step with the site it's being submitted to.

Never paste your API token into the chat. The skill reads it from the
environment or `.env` precisely so it never lands in a transcript.

## Using it without Claude

`wanikani review` is a full interactive session in the terminal, no model
involved:

```bash
wanikani summary          # level, reviews due now, next review time
wanikani review           # interactive review session
wanikani review --limit 10
```

It quizzes meaning (and reading, for kanji and vocabulary), takes kana or
romaji, and accepts both halves on one line in either order. `:show` reveals an
answer, `:quit` stops early — anything already answered is submitted as you go,
so nothing done is lost.

## Drills and critical items

Two commands ask questions that aren't reviews. Neither is due, neither
submits, and nothing either one does reaches your WaniKani account — so they
cost nothing and can be run mid-sitting or on their own. Say "drill my recent
mistakes" or "critical items" and Claude picks the right one; in the terminal
they're `drill` and `critical-condition`.

They differ in what they know:

| | Where the list comes from | What's on it |
| --- | --- | --- |
| `drill` | This tool's own record of your sittings | What you got wrong recently — nothing on a fresh install, and nothing you reviewed on the website |
| `critical-condition` | WaniKani's records, live | Every item it has you under 75% correct on, over your whole history with the item, wherever you reviewed it |

So `critical-condition` is the wider net, and it's the same list
[wanikani.com/critical-items](https://www.wanikani.com/critical-items) shows:

```bash
$ wanikani critical-condition --limit 3
[
  { "subjectId": 440, "prompt": "1. 育", "percentageCorrect": 50, ... },
  { "subjectId": 600, "prompt": "2. 放", "percentageCorrect": 55, ... },
  { "subjectId": 2801, "prompt": "3. 苦労", "percentageCorrect": 67, ... }
]
```

Ten items unless you say otherwise, and the payload says how many more there
are. `--under 60` draws the line somewhere tighter than WaniKani's 75%. Burned
items stay in — an item you burned and still get wrong is exactly what the list
is for, and nothing schedules it any more. Retired subjects don't: they can't
come up again, so their percentage is nobody's problem.

## What this does to your account

Worth being plain about, since it writes to your SRS:

- **Reviews are real.** `ask`/`answer` and `review` submit to
  `POST /reviews` with the wrong-answer counts you actually earned, the same
  way the website does. There is no dry-run mode. Drills and
  `critical-condition` submit nothing.
- **Grading matches the website on purpose**, including where that's strict:
  `shimbun` is wrong for しんぶん here because it's wrong there, and accepting
  it would build a habit the site punishes. Where it is looser, it's over
  things the website would have marked a right answer wrong for — an
  apostrophe, a capital letter, katakana — and every allowance is written down
  in [how grading works](docs/grading.md).
- **Your token stays local.** It's read from your environment or the repo's
  `.env`, sent only to `https://api.wanikani.com/v2`, and never printed — not
  in a command, not in an error. If you're using the Claude Code half, the
  contents of your reviews (the items, your answers) do pass through the model
  as ordinary conversation; your token does not.
- **The only write permission needed is `reviews:create`.** Nothing here uses
  `assignments:start`, `study_materials:*` or `user:update`.
- **Local state is a cache you can delete.** Four files in
  `~/.cache/wanikani-cli` (override with `WANIKANI_CACHE_DIR`): subject
  content, the current sitting's queue order and grades, your recent misses,
  and the last critical-condition fetch. Deleting any of them is always safe.

## Upgrading

```bash
wanikani update
```

Pulls this repo from wherever you ran the command, names what came in, and says
whether the change is live already or wants a Claude Code restart.
[`CHANGELOG.md`](CHANGELOG.md) says what's landed and when.

<details>
<summary>Coming from an install that predates the symlink</summary>

Older installs have a *copy* of the skill at `~/.claude/skills/wanikani/`,
usually with absolute paths hand-edited into it — which is what made it a copy
rather than a link, and what stops it ever being re-copied over. One ran four
releases behind for three weeks, driving sittings with commands that no longer
existed, and nothing about it looked wrong.

To tell which you have:

```bash
ls -l ~/.claude/skills/wanikani     # an arrow to this repo means you're fine
grep -c "queue --limit 10" ~/.claude/skills/wanikani/SKILL.md
```

A match on the second means you're on a pre-`ask`/`answer` version. Migrate
once:

```bash
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

The two that drive a sitting are `ask` and `answer`; the rest are there for the
terminal, for drills, and for the questions that come up mid-batch.

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
and were removed rather than left to rot — an untested path that writes to your
WaniKani account is worse than no path at all, and the Claude-driven teaching
flow behind them had never run either. `summary` still tells you how many are
waiting; do them on wanikani.com, where they'll also be taught better than this
could. The token no longer needs `assignments:start`.

If you want them back, they're in the history — `git log -- lib/commands/lessons.js`.

## Reference

- [Changelog](CHANGELOG.md) — what's landed, newest first.
- [How grading works](docs/grading.md) — what counts as a right answer, and why
  each allowance is there.
- [Why it's shaped this way](docs/design.md) — what the CLI decides instead of
  the model, what it hands back, and how the cache works.
- [`SKILL.md`](.claude/skills/wanikani/SKILL.md) — the instructions Claude
  actually runs on, and [`FAILURES.md`](.claude/skills/wanikani/FAILURES.md)
  beside it, which is what each rule cost before it was a rule. Both are worth
  reading if you're wondering why anything here is the shape it is.

## Tests

```bash
npm test
```

Node's built-in runner, no test framework — there's no linter or formatter in
the project, so `npm test` is the whole check. The WaniKani API is stubbed
throughout and never called; anything that writes is pointed at a temp
directory, including the `update` tests, which drive a real `git` against
throwaway clones. So it runs offline in well under a minute. CI runs it on
Node 20.12 (the floor `engines` declares), 22, and 24.

## Claude Code on the web

`.claude/hooks/session-start.sh` runs `npm install` when a session starts in a
remote environment, which begins from a fresh clone with no `node_modules` —
without it the CLI can't run and `npm test` fails at import. It's a no-op
locally (gated on `CLAUDE_CODE_REMOTE`) and safe to re-run.

## Notes

- Talks directly to `https://api.wanikani.com/v2`; see WaniKani's [API
  docs](https://docs.api.wanikani.com/) for the underlying resources.
- Respects the 60-requests/minute rate limit by waiting for the reset the API
  reports on an HTTP 429. Failed GETs are retried with backoff; writes
  (`POST /reviews`) are never replayed, since a request that timed out may
  still have landed.
- Not affiliated with or endorsed by Tofugu / WaniKani.
