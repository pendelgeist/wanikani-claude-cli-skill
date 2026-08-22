# Changelog

No version numbers and no releases — the repo is the release. `wanikani update`
pulls the latest and says whether the change is live already or wants a Claude
Code restart.

Entries are newest first, dated by the day they landed on `main`, and each one
says what changed for whoever is doing the reviews. Nearly all of them started
as something going wrong in a real sitting;
[`FAILURES.md`](.claude/skills/wanikani/FAILURES.md) is the same history from
the other end, with what each one cost before it was fixed.

## 2026-08-22

- **`ask` prints the question first.** A sitting used to open with the
  answering convention, then a note for the driver, then the item — and Claude
  Code shows a command's first lines and folds the rest, so what reached the
  screen was two notes and a `+2 lines`. Two sittings in one day opened that
  way; one had its first item answered by someone who never saw it. The
  question leads now and the notes go under it.
- **A near miss names what it was near.** The line under a wrong meaning used
  to say only that the answer was close. It now names the accepted meaning it
  came closest to:

  ```
  ✗ meaning is Alcohol · https://www.wanikani.com/radicals/alcohol
  (close to "Alcohol" — a typo on that word is `answer --forgive meaning`; a different word isn't)
  ```

  伝える answered "to transfer" is three edits from "To Transmit" — close
  enough to flag, and not a typo — and it was forgiven on the flag alone,
  which credits a level WaniKani wouldn't have given. The judgment being asked
  for is a comparison, so both words are on the screen.
- **`explain` output is printed, not summarised.** Asked the difference between
  場 and 所, a sitting ran both, printed neither, and wrote a usage rule
  underneath that was in neither block and was wrong.

## 2026-08-21

- **`critical-condition` (short: `critical`)** — the list
  [wanikani.com/critical-items](https://www.wanikani.com/critical-items)
  shows, fetched live: every item WaniKani has you under 75% correct on, worst
  first. Ten by default, `--limit N` for more, `--under P` to move the line.
  Nothing on it is due and nothing submits, same as `drill`. Say "critical
  items" mid-sitting.
- **`explain` with nothing after it means the item that's open**, so a bare
  "explain" or "why?" no longer needs the character copied across.
- **The driver note is said once a sitting** rather than on every batch — seven
  copies in a sixty-one item sitting, each one pushing the question it came
  with into the fold.
- A missed drill item no longer prints `(recorded — next item)` directly above
  `(drill — nothing recorded, nothing submitted)`.

## 2026-08-20

- **Lessons are gone.** `lessons` and `start` were never once used and were
  removed rather than left untested — an unexercised path that writes to your
  account is worse than no path. `summary` still says how many are waiting;
  do them on wanikani.com. Your token no longer needs `assignments:start`.
- **A reply with a kanji in it is a question, not an answer.** "tip 育" went
  into the grader verbatim and cost the item. Meanings are English and readings
  are kana, so anything in Han script is refused and pointed at `explain`.
- **`--forgive`, on the screen.** A meaning wrong by a hair now says so under
  the correction, with the override next to it. It had been documented since
  the beginning and used exactly never, across six sittings that included
  several plain typos.
- **Batches are ten items** unless you say otherwise. One sitting was served
  all 67 reviews that were due as a single batch, and a batch only submits once
  every item in it is answered.
- **`wanikani update`** — pulls this repo from wherever you ran the command,
  names what came in, and says whether it needs a Claude Code restart.
- **The skill can be symlinked instead of copied.** Every command in it is now
  path-free, so `~/.claude/skills/wanikani` can be a link to this repo. One
  copied install ran four releases behind for three weeks and looked normal
  throughout.
- **Readings are compared by sound.** `SHIN` was becoming シン and missing しん
  — caps lock or dictation was enough to lose an item — and ページ's romaji
  matched nothing at all, which was a false miss on every katakana word in
  WaniKani.
- **A space can separate a volunteered reading** on a meaning-only item: 少
  answered "few shou" is graded as "few". Punctuation already worked; the
  separator most people reach for did not.
- The first question of a batch is chosen exactly the way the tenth is — the
  fetch path was reaching past the resolver and could print a literal `null`,
  or ask one item while grading another.
- README cut back to install and usage, with the reasoning moved to
  [`docs/`](docs/).

## 2026-08-19

- **The review loop became two commands.** `ask` prints the question that's
  waiting; `answer "<their whole reply>"` grades whatever is open and prints
  the verdict and the next question. Neither takes an id. Which of ten subject
  ids a reply belonged to, whether the batch was finished, and when to submit
  all moved out of the driver's head and onto the record on disk — every one of
  those had been got wrong in a real sitting, and a sitting now survives a new
  conversation walking into the middle of it.
- The question stays a fragment on purpose. Issuing it as a finished question
  (`— meaning & reading?`) was tried and reverted within a day: the sitting
  that met a complete question answered it itself, on four items out of five.
- Lookup links are percent-encoded, so terminals linkify the whole URL.

## 2026-08-18

- **`grade` returns the whole message** — the verdict, then the next question —
  so there is nothing to compose between two items.
- **`drill`**: the items you last got wrong, re-asked. Nothing in it is due and
  nothing submits.
- **`status`** answers "did that go through?" from the local record — no token,
  no network, so it works when nothing else does.
- **A miss survives the item being asked again in the same sitting.** Clearing
  the record decides what gets *asked*; it shouldn't decide how well you did.
- **A settled item refuses a second answer.** The correction has already
  revealed the answer, so a re-ask grades the reveal — one sitting handed six
  answers back that way and printed `✓ Correct` over misses already recorded.

## 2026-08-17

- **Rapid fire**: `prompts` lists what's still open as one block, `grade-many
  "<a> | <b> | …"` grades a whole batch answered in one message, in order. More
  answers than open items is refused rather than misaligned.

## 2026-08-14

- **A sitting no longer expires underneath itself.** The queue order ages out
  after 30 minutes *idle*, so a long sitting stays alive and an abandoned one
  submits nothing and says so.
- **"shinyuu" is read both ways.** 親友 is しんゆう, and every romaji converter
  reads that as し・にゅう without an apostrophe. Both parses are tried; the
  alternate is only accepted when it turns out to be one of the item's
  readings, so it can't promote a wrong answer.
- **A bare reply after "Reading?" is graded as the reading.** It had been
  graded as a meaning — closing the item as two misses when the answer was
  right — since the day `grade` landed.
- **Asking an item clears what it had recorded.** A batch went in carrying
  grades from a previous session's abandoned attempt: ten items answered
  correctly, submitted as "10 done, 2 perfect" with four demotions.

## 2026-08-13

- **Grading moved into code.** Meaning matching with WaniKani's own typo
  tolerance, romaji-to-kana conversion, which half of "fur, ke" is the reading
  — all of it a lookup table in `lib/grading.js` rather than prose re-read on
  every answer, which is how 親 answered "parent, oya" once cost an SRS level.
- **Another of the kanji's readings re-prompts instead of counting.** 親 wants
  しん, but おや is a real reading of it and nothing on the prompt says which is
  wanted — so the CLI names the type it's after and waits, the way the website
  shakes and lets you try again.
- **The lookup link is welded onto the correction line.** As a field beside it,
  it went unprinted for weeks.
- **`explain`** — the item-info screen (meanings, readings, parts, mnemonics,
  hints, context sentences), on request.
- **`tips`** — everything you can say during a session, in the words you'd say
  it in.
- Any separator between the two halves of an answer: `,` `.` `;` `/` `|` `x`
  `、` or a plain space, in either order.
- `review` takes both halves on one line too, and session counts live in a file
  instead of in the driver's head.

## 2026-08-10

- **The prompt, the corrections and the batch summary are composed in the
  CLI.** Three bugs of the same shape — a gloss grown onto a prompt, a reading
  transliterated back into romaji, a hand-kept tally that disagreed with what
  was submitted — were all formatting, and formatting belongs in code.
- **A glyph-less radical's prompt is its image URL**, printed whole. Naming it
  names the answer; describing it (`5. Radical`) shows nothing, and the user
  answered a picture they never saw.
- Subject cache with a daily patch from the API, cached queue order per
  sitting, rate-limit handling that waits for the reset the API reports, GETs
  retried with backoff, and `POST /reviews` never replayed.
- Strict romanization recorded as a decision: `shimbun` is wrong here because
  it's wrong on the website, and accepting it would build a habit the site
  punishes.
- CI on Node 20.12, 22 and 24; `npm install` on session start for Claude Code
  on the web.

## 2026-07-29 → 2026-08-04

- The starting point: a `wanikani` CLI (`summary`, `review`, `queue`,
  `submit`, `submit-batch`) talking to `https://api.wanikani.com/v2`, and a
  skill file telling Claude how to drive it.
- Radical images surfaced rather than described, meaning-name labels banned
  from prompts, and — the rule that outlived every rewrite — **never answer on
  the user's behalf**. A session had printed, answered and graded an item
  inside one message, submitting a perfect score for a question nobody was
  asked.
