# How grading works

What counts as a right answer, and why each allowance is there. The rules live in `lib/grading.js`, unit tested in `test/grading.test.js`.

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
- **A near miss says so, and says what it was near.** Wrong by one edit past
  the tolerance and the correction gains a line offering the override —
  `(close to "Alcohol" — a typo on that word is \`answer --forgive meaning\`; a
  different word isn't)`. It names the accepted meaning it came closest to
  because the judgment being asked for is a comparison: 伝える answered "to
  transfer" is three edits from "To Transmit", near enough to flag and not a
  typo, and it was forgiven on the flag alone — which credits a level the
  website wouldn't have given. It only offers; the miss stays on the record
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
