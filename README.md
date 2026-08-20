# wanikani-cli

[![test](https://github.com/pendelgeist/wanikani-claude-cli-skill/actions/workflows/test.yml/badge.svg)](https://github.com/pendelgeist/wanikani-claude-cli-skill/actions/workflows/test.yml)

Do your [WaniKani](https://www.wanikani.com/) lessons and reviews from the
terminal instead of the web app — either as a plain Node CLI, or as a Claude
Code skill that drives the quiz conversationally.

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

You type the answers; Claude passes them through and prints what comes back.
Grading, the batch, and when to submit are the CLI's, which is the whole
design — see [Usage as a skill](#usage-as-a-claude-code-skill).

Prefer to drive it yourself? `wanikani review` is a full interactive session
in the terminal, no Claude involved.

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
   | `assignments:start` | `start`, `lessons --start` |
   | `reviews:create` | `ask` (it submits finished batches), `review`, `submit`, `submit-batch` |

   Leave `study_materials:*` and `user:update` unchecked — nothing here uses
   them. A read-only token with nothing checked is enough for `summary`,
   `lessons`, `queue`, `explain`, `status` and `tips`, but not for doing
   reviews: answering records locally, and sending that record needs
   `reviews:create`.

3. Put `wanikani` on your `$PATH`:

   ```
   npm link
   ```

   Everything below is written `wanikani …` because that works from any
   directory, which is what the Claude skill needs. Without it, substitute
   `node /path/to/this/repo/bin/wanikani.js …` throughout.

4. Make the token available to the CLI — either:

   ```
   export WANIKANI_API_TOKEN=...
   ```

   or copy `.env.example` to `.env` and paste the token in. The CLI loads
   `.env` from the repo root whatever directory you run it in, so there are no
   flags to pass and nothing to re-export.

5. Confirm it works:

   ```
   wanikani summary
   ```

## Usage (plain CLI)

```
wanikani summary          # level, lessons/reviews due now, next review time
wanikani lessons          # show available lessons + mnemonics
wanikani lessons --start  # ...and prompt to mark each one started
wanikani start 123 456    # mark specific lessons started, no prompting
wanikani review           # interactive review session
wanikani review --limit 10
```

`review` quizzes meaning (and reading, for kanji/vocabulary), accepting kana
or romaji for readings. Answer both on one line if you like — "fur, ke", in
either order, split the same way the Claude session splits it — and it only
asks for what's still missing. Type `:show` to reveal an answer or `:quit` to
stop early; items already answered are submitted immediately, so nothing
already done is lost.

## Installing the skill

The skill lives in this repo at `.claude/skills/wanikani/`, and if you run
Claude Code *in* this repo it's already found. Anywhere else it needs to be
where Claude Code looks — one symlink, from the repo root:

```
ln -s "$PWD/.claude/skills/wanikani" ~/.claude/skills/wanikani
```

**Symlink it; don't copy it.** A copy goes stale the moment the repo moves on,
and silently: the session keeps working, just to last month's instructions. A
real one ran four releases behind for three weeks, driving sittings with
commands that had been replaced, and nothing about it looked wrong from the
outside. With the symlink there is no second copy to fall behind.

The `npm link` from setup is what makes the symlink safe. The skill calls
`wanikani …` rather than `node bin/wanikani.js …` precisely so it doesn't
depend on which directory the session started in — which is the thing that
used to force people to hand-edit absolute paths into their copy, and a
hand-edited copy is one you can never re-copy over.

Restart Claude Code after linking, then say `/wanikani`.

## Upgrading

If the skill is symlinked and `wanikani` is on your `$PATH` — the install
above — one command does it:

```
wanikani update
```

It pulls this repo from wherever you ran it, names what came in, and ends by
saying which kind of change it was: **CLI only** is live immediately, and **the
skill text changed** means restart Claude Code before your next sitting.

### Coming from an older install

Installs from before the symlink was documented have a *copy* of the skill at
`~/.claude/skills/wanikani/`, usually with absolute paths hand-edited into it
so it would run from outside the repo — which is what made it a copy rather
than a link, and what stops it ever being re-copied over.

To tell which you have:

```
ls -l ~/.claude/skills/wanikani     # an arrow to this repo means you're fine
grep -c "queue --limit 10" ~/.claude/skills/wanikani/SKILL.md
```

A match on that second line means you're on a pre-`ask`/`answer` version.
Migrate once:

```
cd /path/to/wanikani-claude-cli-skill
git pull
npm install
npm link
rm -rf ~/.claude/skills/wanikani
ln -s "$PWD/.claude/skills/wanikani" ~/.claude/skills/wanikani
```

Then restart Claude Code, and check it took: the first call of a sitting
should be `wanikani ask`, not `wanikani queue --limit 10`. From then on
`wanikani update` is the whole story.

Nothing in your WaniKani account needs migrating — the CLI keeps no state
beyond a cache you can delete (see [Caching](#caching)), and every version of
this tool submits the same reviews the website does.

## Usage (as a Claude Code skill)

Open this repo in Claude Code and ask it to do your WaniKani reviews (or use
`/wanikani` if it's registered as a slash command). See
[`.claude/skills/wanikani/SKILL.md`](.claude/skills/wanikani/SKILL.md) for
what it does — which is very little, deliberately. The whole review loop is
two commands:

```
wanikani ask                            # prints the question that's waiting
wanikani answer "<your whole reply>"    # prints the verdict and the next question
```

`ask` fetches a batch when there isn't one, re-asks the open item when there
is, and submits a finished batch before serving the next. `answer` grades
against whatever is open. Neither takes an id, and nothing about the batch is
held in the conversation — it lives in a file, so a sitting survives a new
session walking into the middle of it, and a 600-review session is a couple
dozen tool calls rather than hundreds.

That shape is the result of several sittings' worth of things going wrong.
Every decision left to the model eventually got made wrong — which of ten
subject ids this reply belongs to, whether the batch was exhausted, whether
it was time to submit — so those decisions were moved into the CLI one at a
time until there were none left. What remains in the skill is five rules
about what it says and what it passes along, and
[`FAILURES.md`](.claude/skills/wanikani/FAILURES.md) records what each one
cost before it was a rule.

You can answer meaning and reading together in one line (e.g. "fur, ke"), it
auto-advances without needing you to say "next", and it links out to
[Jisho](https://jisho.org/) on anything you get wrong so you can dig into it
right away.

Once you've got a rhythm, one item per message is the slow part, so say
**"rapid fire"** (or just answer a few at once) and the rest of the batch
arrives as one numbered list. Answer the whole thing in a single message
separated by `|` — `shore, kishi | low, tei | …` — and it comes back as one
verdict line per item, with anything you skipped or got re-prompted on listed
again for the next round. That's `wanikani prompts` and `wanikani grade-many`
underneath, and both exist so the list of questions and the mapping from your
answers back to them come out of the data rather than out of Claude's memory:
a session that wrote its own list printed nine items' meanings and readings —
the answers — as the question. Say "one at a time" to go back.

You don't have to know any of that up front. Ask **"what can I say?"** at any
point — or run `wanikani tips` — for the whole list of what a session
understands, from "more" to how to slow the auto-advance down. The
start-of-sitting note points at it, and that's the only time the tool brings
it up unasked; nothing is drip-fed between items.

Ask to **re-review your recent mistakes** and it drills them: `wanikani drill`
returns the items you last got wrong, as questions, from the record rather than
from anyone's memory of the session. They're graded the same way and submit
nothing — they went in when their batch did.

Ask **"did that go through?"** and it reads the record instead of counting
back through the chat: `wanikani status` says how much of the batch is
answered, how many answers are on record and not yet sent, what's been
submitted so far, and which call comes next. It reads local files only — no
token, no network — because the moment you most want it is the moment
something else isn't working. Answering never sends anything on its own, and
an item stays due until it's submitted, so a batch that didn't submit is a
batch still waiting rather than an hour of work lost.

Say **"more"** on an item and it pulls up the full entry — mnemonics, hints,
what the kanji is built from, the other readings, example sentences. That's
`wanikani explain` under the hood, and it only ever runs because you asked:
most misses are a typo you don't want a lecture about, and the ones that
aren't are the reason the word exists. It refers to the item just graded, not
the one currently on screen, so asking never hands you an answer you were
about to give.

For lessons it works the other way round — it reads `wanikani lessons --json`,
teaches each item conversationally (characters, meaning, reading, mnemonic in
its own words), and marks the ones you've learned started with a single
`wanikani start` call, so the whole lesson runs in chat instead of handing you
back to a terminal.

Never paste your API token into the chat — the skill is instructed to read
it from your shell environment or a local `.env` file instead, precisely so
it never ends up typed into a command (and therefore into a transcript).

## How grading works

Both the interactive `review` command and the Claude skill grade through the
same code. `answer` splits the reply into its meaning and reading halves — on
any of `,` `.` `;` `/` `|` `x` `、` or a plain space, in either order — judges
each, records the result, and prints the exact line to say:

```
$ wanikani answer "parent, oya"
That's a real reading, but WaniKani wants the on'yomi here — try again.
(same item — still their turn)

$ wanikani answer "parent, mi"
✗ reading is しん (on'yomi) · https://jisho.org/search/%E8%A6%AA%20%23kanji
(recorded — next item)

2. 心強い
```

(`grade <subjectId> "…"` is the same grading with the item named explicitly.
It's what `drill` and the rapid-fire path use, and what `answer` calls
underneath.)

It prints the line to say and nothing else to summarise; `--json` adds the
full verdict (`parsed`, `recorded`, per-part statuses) for anything that wants
to inspect rather than speak. When an item is mid-question — it asked
`Reading?`, or re-prompted for the right kind of reading — the next bare reply
is graded as the reading it was waiting for, so answering in two turns costs
nothing.

Each verdict goes straight onto the sitting's record, so `submit-batch`
submits what was actually graded rather than a tally kept by hand. Once an item
is settled it stays settled: a second answer to it is refused rather than
graded again, since the correction has already shown the answer and attempts
add up rather than replacing one another — a ✓ typed back from the reveal would
sit on top of the miss it appeared to cancel. Asking an item *again* — a fresh
`queue` — does clear what it had recorded, because an abandoned attempt
shouldn't submit itself later against answers nobody gave; and while a batch
holds graded, unsubmitted answers, `queue` refuses to re-serve at all and says
to submit first (`--restart` bins them on purpose).
A miss also survives the item being asked again inside the same sitting: the
new answer is graded on its merits, and the earlier miss is submitted with it
(`submit-batch` says how many carried). Clearing the record decides what gets
*asked*, and shouldn't be able to decide how well someone did — a session that
replayed a lost sitting out of its own chat log, corrections included, sent
thirty items in as perfect scores and burned four of them.
`grade <id> --forgive meaning` takes a miss back when the answer key was
overruled. That record lives with the queue order, which ages out after 30
minutes *idle* — a sitting that's still being worked stays alive however long
it runs, and one abandoned overnight submits nothing and says so, with its
items still due.

The queue order also remembers which items the last `queue` handed out and in
what order, which is what makes "the batch" something the CLI knows rather than
something the caller holds in its head: `prompts` lists the ones still
unanswered (keeping the numbers they were asked under), `grade-many` maps a
one-line reply onto them in order, and both are counting jobs that were
otherwise being done in prose nine items into a batch.

That's deliberate: the rules below are a lookup table, and a lookup table
interpreted afresh on every answer is a lookup table that eventually gets
one wrong — which is how 親 answered "parent, oya" once cost an SRS level.
What's left to judgment is whether a mangling well past a typo was meant as
the right answer and whether a synonym is fair, which is the part a person (or
a model) is actually better at than a table.

- **Meaning**: case/whitespace-insensitive match against the subject's
  accepted meanings plus whitelisted auxiliary meanings; blacklisted
  auxiliary meanings (things that look right but aren't) are always rejected.
- **A typo in a meaning is forgiven**, the way the website forgives one:
  nothing on a word of three letters or fewer, one edit up to seven, two
  beyond that, with a swap of adjacent letters counting as one edit rather
  than two. So "goverment official" and "pubilc official" are correct, and
  "officer" still isn't. Exact matches settle it first in both directions;
  only then is distance measured, and the nearest meaning wins, so a slip on a
  blacklisted meaning is still that meaning unless the answer is closer to one
  the item accepts.
- **Reading**: romaji input is converted to kana (via
  [wanakana](https://www.npmjs.com/package/wanakana)) before matching against
  the subject's accepted readings. The `dzu`/`dzi`/`dji` spellings of づ/ぢ are
  folded onto `du`/`di` first, since wanakana only understands the latter.
- **A long vowel typed twice is the same reading.** ページ is "peeji" to most
  people and "pe-ji" to a converter, so a doubled vowel is also tried as ー.
- **An `n` before a vowel or `y` is read both ways.** "shinyuu" is しんゆう to
  a reader and しにゅう to a converter — which is why strict Hepburn writes
  shin'yū — so both parses are tried and either may match. This is a
  deliberate step *away* from the website, which requires the apostrophe: the
  alternate parse is only ever accepted when it turns out to be one of that
  item's readings, so it can't promote a wrong answer, and 親友 answered
  "shinyuu" is someone who knew the word losing a level to punctuation.
- **Script and letter case never decide a reading.** wanakana reads a capital
  as a katakana signal, so `SHIN` used to become シン and miss しん — caps
  lock or dictation was enough to lose an item. Readings are compared by
  sound now, which also fixes the opposite case: ページ's reading *is*
  katakana, so "peeji", the only romaji anyone would type for it, matched
  nothing at all.
- **The ways people actually type ん all reach ん.** Doubling the n is what
  every IME teaches, so "jinnja" is じんじゃ; an apostrophe anywhere but
  directly after an n is a habit rather than a sound, so "ji'n'jya" is too.
- **A meaning-only item sheds a volunteered reading.** Radicals and kana
  vocabulary are asked for a meaning alone, but the habit of a sitting is
  "meaning, reading" on one line and it doesn't switch off for one item in
  ten. `few shou` on 少 is graded as `few`. Only when what precedes the tail
  stands as a correct answer on its own, so a spray of guesses is still a
  spray.
- **A near miss says so.** Wrong by one edit past the tolerance and the
  correction gains a line offering the override — `(close — \`answer --forgive
  meaning\` if that was a typo)`. It only offers; the miss stays on the record
  until someone decides. A blacklisted meaning is never near, whatever the
  distance, since those are the ones WaniKani lists to mean "looks right,
  isn't".
- **Another of the kanji's readings**: 親 wants しん, but おや and した are real
  readings of it too, and nothing on the prompt says which one is being asked
  for. That's not graded wrong — as on the website, it re-prompts and names
  the type it's after ("WaniKani wants the on'yomi here"), and the item's
  score is untouched. A vocabulary word's rejected readings are near-miss
  spellings rather than alternatives, so they get no such reprieve: こころずよい
  for こころづよい stays wrong.

Romanization otherwise follows WaniKani's own conversion exactly, on purpose:
traditional Hepburn's *m* before b/p/m is **not** accepted, so `shimbun` is
wrong for しんぶん just as it is on the website (it converts to しmぶん). That's
a deliberate choice to keep this tool's grading and your WaniKani record in
agreement — accepting it here would quietly build a habit the site punishes.

See `lib/grading.js` (unit tested in `test/grading.test.js`).

## Commands reference

| Command | Purpose |
| --- | --- |
| `summary [--json]` | Level, lessons/reviews available, next review time |
| `lessons [--json] [--limit N] [--start]` | Available lessons; `--json` adds assignment ids and mnemonics for the Claude skill, `--start` prompts to mark each started (needs a TTY) |
| `start <assignmentId> [<assignmentId>...]` | Mark lesson assignments started — the non-interactive counterpart to `lessons --start` |
| `review [--limit N]` | Full interactive review session |
| `ask [--limit N]` | The question that's waiting, printed: fetches a batch when there isn't one, re-asks the open item when there is, submits a finished batch before serving the next. Batches are ten unless you say otherwise |
| `answer "<your whole reply>" [--forgive meaning\|reading]` | Grade that reply against whatever is open, then print the verdict and the next question. No id: the record knows which item is open. `--forgive` takes the last verdict back |
| `queue [--limit N] [--answers] [--restart]` | Due reviews as JSON: questions and ids, no answers. Refuses while answers are graded and unsubmitted; `--restart` discards them deliberately, `--answers` restores the key for debugging |
| `drill [--limit N]` | The items answered wrong recently, as questions — same shape as `queue`. Nothing in it is due and nothing submits |
| `prompts` | The still-unanswered questions in the current batch, as one block to print — the rapid-fire list |
| `grade <subjectId> "<answer>" [--meaning M] [--reading R] [--forgive meaning\|reading]` | The same grading with the item named explicitly — what `drill` and rapid-fire use, and what `answer` calls underneath |
| `grade-many "<a> \| <b> \| ..."` | Grade a batch answered in one message, in the order `prompts` listed it. Blanks stay open; more answers than open items is refused rather than misaligned |
| `explain <id\|characters> [--json]` | Everything WaniKani teaches about one item — mnemonics, hints, what it's built from |
| `status [--json]` | What the current sitting's record holds: how much of the batch is answered, how much is waiting to be sent, and the next call to make (no token needed) |
| `tips` | Everything you can say during a session, all at once (no token needed) |
| `update` | Pull this repo from wherever you ran it, and say whether the change is live already or wants a Claude Code restart (no token needed) |
| `submit <assignmentId> [--wrong-meaning N] [--wrong-reading N]` | Submit one graded review |
| `submit-batch` | Send everything graded this batch, in one call. Works on a part-answered batch too: what's answered goes, the rest stays due — which is what to run when you stop early |

The CLI hands back finished strings rather than raw data to assemble, and —
since a session that *can* grade by hand eventually will — it no longer hands
over the answers at all. `queue` gives each item a `prompt` (`"1. 心強い"`, or
the image URL for a radical with no glyph) and the ids to act on it;
`grade` holds the key and returns the line to print. The prompt is a fragment
and not a finished question on purpose: for one release it ended in
`— meaning & reading?`, and the sitting that met a complete question answered
it — the answer typed under four prompts in a row, and on one item the user's
correct reply passed over in favour of the guess. `grade` prints the verdict
and the next prompt itself, so a Claude-driven sitting has nothing to say
between items at all. With `--answers`, for
debugging, the old shape comes back: `corrections` — `meaning`, `reading` and
`both`, one finished line each, kana copied straight from the answer key, the
reading labelled with its type for a kanji, and a lookup link welded onto the
end:

  ```
  meaning is Parent · reading is しん (on'yomi) · https://jisho.org/search/%E8%A6%AA%20%23kanji
  ```

  The link is part of the line rather than a field beside it because a field
  beside it doesn't get printed — it went unused in every real session until
  it stopped being optional. Jisho's kanji page for kanji (its *word* page for
  親 is おや, the reading you were just told was wrong), its word page for
  vocabulary, WaniKani's own page for radicals.
- An item with other real readings also gets `otherReadings` (the kana that
  should be re-prompted rather than marked wrong) and `readingNudge`, the
  finished re-prompt naming the type wanted.
- `explain` gives a whole formatted block, the item-info screen the website
  shows *after* you answer:

  ```
  親 — kanji, level 2
  Meaning: Parent
  Reading: しん (on'yomi) — also read おや / した (kun'yomi), though not here
  Parts: 立 (Stand) + 木 (Tree) + 見 (See)
  Meaning mnemonic: …
    Hint: …
  Reading mnemonic: …
  More: https://www.wanikani.com/kanji/%E8%A6%AA · https://jisho.org/search/%E8%A6%AA%20%23kanji
  ```

  It takes the `subjectId` from a queue item or the characters themselves
  (`explain 親` explains both the kanji and the word, since it can't know
  which you meant). `--json` gives the fields instead of the block.
- `submit-batch` gives a `summaryLine` — `10 done, 8 perfect · 心強い → Guru ·
  127 left` — naming what crossed an SRS tier, carrying a running session
  total, and dropping segments that would say nothing. If an item failed to
  submit, the line gains a second line saying what becomes of it: a retryable
  failure stays in the queue for a later batch, one WaniKani rejected
  outright (usually already reviewed elsewhere) doesn't come back.

The raw fields are still there for grading (`meanings`, `readings`,
`auxiliaryMeanings`) and for anything that wants to say more than the line
does (`results`, `batch`, `remaining`). Composing these in code rather than
describing them in the skill is deliberate: a prompt that grew a gloss and a
correction that came back in romaji were both formatting bugs, and formatting
is what code is reliable at.

## Caching

Two files live in `~/.cache/wanikani-cli` (override the location with
`WANIKANI_CACHE_DIR`; deleting either one is always safe):

- `subjects.json` — subject content (characters, meanings, readings,
  mnemonics), written the first time each subject is fetched. WaniKani's own
  docs recommend caching subjects aggressively since they rarely change, so
  entries have no TTL. They aren't frozen, though — accepted meanings get
  added and readings get corrected — so once a day the CLI asks the API
  what's changed since the last check and patches the entries it holds. That
  refresh is best-effort: if it fails, the session carries on with what's
  cached and tries again next time.
- `queue-order.json` — the shuffled order of the reviews due in the current
  session, so a second `queue --limit 10` slices the next ten rather than
  re-fetching every due assignment. Submitting removes items from it;
  anything answered but not submitted stays put and comes back around, as does
  anything left mid-question — an unanswered re-prompt is not submitted as a
  clean pass. The order expires after 30 minutes, and is re-fetched whenever it
  runs dry.

Assignment, review, and summary data are otherwise always fetched live.

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
- `review`/`lessons --start` do real writes to your WaniKani account (SRS
  progress, lesson start times) — there's no dry-run mode.
