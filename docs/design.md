# Why it's shaped this way

Every decision in the review loop that was left to the model eventually got
made wrong — which of ten subject ids a reply belonged to, whether the batch
was exhausted, whether it was time to submit. They were moved into the CLI
one at a time until none were left. This is the record of what each move was
for; [`FAILURES.md`](../.claude/skills/wanikani/FAILURES.md) is the record of
what it cost first.

## What the CLI hands back

The CLI hands back finished strings rather than raw data to assemble, and —
since a session that *can* grade by hand eventually will — it no longer hands
over the answers at all. `queue` gives each item a `prompt` (`"1. 心強い
(vocabulary)"`, or the image URL and the same label for a radical with no
glyph) and the ids to act on it; `grade` holds the key and returns the line to
print. The prompt is a fragment
and not a finished question on purpose: for one release it ended in
`— meaning & reading?`, and the sitting that met a complete question answered
it — the answer typed under four prompts in a row, and on one item the user's
correct reply passed over in favour of the guess. `grade` prints the verdict
and the next prompt itself, so a Claude-driven sitting has nothing to say
between items at all.

The type on the end of the prompt is the one part of it that isn't a
formatting decision. A glyph alone is sometimes not a question: 末 is すえ as a
word and まつ as a kanji, and a sitting that met both fifteen minutes apart
answered each with the other's reading and lost both. WaniKani never shows a
bare glyph either — its review screen colours by type and labels the question
"Kanji Reading" or "Vocabulary Reading" — so the label is a missing half of
the question rather than a hint, and it is the only Latin text a prompt
carries.

With `--answers`, for debugging, the old shape comes back: `corrections` — `meaning`, `reading` and
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
- `submit-batch` prints one line — `10 done, 8 perfect · 心強い → Guru ·
  127 left` — naming what crossed an SRS tier, carrying a running session
  total, and dropping segments that would say nothing. If an item failed to
  submit, the line gains a second line saying what becomes of it: a retryable
  failure stays in the queue for a later batch, one WaniKani rejected
  outright (usually already reviewed elsewhere) doesn't come back. The line is
  all it prints, because Claude Code folds a command's output past the first
  few lines: the payload this used to dump is a hundred and fifty lines for a
  batch of ten, and the sentence written for the user arrived on screen as
  `{`, `"summaryLine": …`, `"results": [`. `--json` still gives the payload.

The raw fields are still there for grading (`meanings`, `readings`,
`auxiliaryMeanings`) and, behind `--json`, for anything that wants to say more
than the line does (`results`, `batch`, `remaining`). Composing these in code rather than
describing them in the skill is deliberate: a prompt that grew a gloss and a
correction that came back in romaji were both formatting bugs, and formatting
is what code is reliable at.

## Caching

Four files live in `~/.cache/wanikani-cli` (override the location with
`WANIKANI_CACHE_DIR`; deleting any of them is always safe):

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
  clean pass. The list ages out after 30 minutes idle, and is re-fetched
  whenever it runs dry — but the sitting's running totals are the file's other
  half and have a longer life: a break for the next hour's reviews to unlock
  is a fetch of fresh items, not a new sitting, and the counter on screen
  carries across it. Three hours idle is where the sitting itself ends and the
  next one starts from zero. What a break does *not* carry is a miss waiting
  to be submitted; see `resumedFrom` in `lib/reviewQueue.js`.
- `misses.json` — the last hundred items answered wrong, filed as each batch
  is submitted, newest first. It's what `drill` asks from, and it outlives the
  sitting the mistake was made in because a mistake does.
- `critical.json` — the subject ids from the last `critical-condition` fetch, and
  nothing else: the list itself comes live from WaniKani every time. It's kept
  only so that `grade` can tell a critical-item drill from an answer that
  belongs to no batch, and so a later session still can. Each fetch replaces
  it outright, which is how an item that climbs back over the line stops being
  treated as a drill.

Assignment, review, and summary data are otherwise always fetched live.
