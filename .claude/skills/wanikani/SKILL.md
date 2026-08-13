---
name: wanikani
description: Run a WaniKani lesson or review session from Claude Code, using the wanikani CLI in this repo to talk to the WaniKani API. Trigger on "/wanikani", "do my wanikani reviews", "wanikani lessons", or similar requests to study kanji via WaniKani.
---

# WaniKani study session

Invoked with nothing more specific ("/wanikani", "do my wanikani reviews"),
go straight into Reviews below — `summary`, then fetch and quiz. Don't offer
a menu of subcommands; branch to Lessons or the Status check only if their
own wording asked for one. If plan mode is active, exit it immediately
rather than asking: this is fetch-quiz-submit, not a code change for plan
mode to gate.

Most of a review turn is a CLI call and a printed string — it needs no
deliberation. If the current model or reasoning effort is a slow one,
mention once at the start of the first batch that `/model` or `/fast` makes
the session noticeably snappier, then drop it.

## Running the CLI

`bin/wanikani.js` talks to the WaniKani API and needs `WANIKANI_API_TOKEN`.
Run commands plain, from the repo root: `node bin/wanikani.js summary`. The
CLI auto-loads `.env` from the repo root, so nothing needs passing in. Run
`npm install` first if `node_modules/wanakana` doesn't exist.

**Never put the token value in a Bash command** (`export
WANIKANI_API_TOKEN=<value> && node …`). It gets echoed verbatim into the
visible tool call and from there into transcripts — that's a leak. Don't ask
for the token in chat either, and don't type it yourself: the errors carry
their own remedy, so pass them on rather than improvising one. "No API token
found" already says to copy `.env.example`, and a 403 already names the one
permission checkbox that call needed — which is a settings change, not a
retry.

## Reviews (the main flow)

Drive the quiz in chat rather than shelling out to the interactive `review`
command — you can use judgment on typos and phrasing that a rigid string
match rejects.

**You can't grade these yourself: `queue` returns the questions and no
answers.** Every reply goes through `grade`, which holds the key, records the
miss and hands back the line to print. A session that skipped it graded
twenty items from memory, and the bill was: romaji in every correction, not
one lookup link, a batch tally that contradicted its own submission, a
mnemonic declared not to exist without looking, an item answered on the
user's behalf, and the next item's meaning printed above its own prompt. The
answer key isn't in the payload any more, so most of that is now unreachable
— what's left is inventing answers from memory, and that's what this rule is
for.

**The loop:**

1. `queue --limit 10`
2. Print the first item's `convention` if it has one.
3. Print `item.prompt`. Stop. Wait.
4. `grade <subjectId> "<their whole reply>"`. Print its `say`. `open: true`
   → the same item is still waiting; otherwise record the counts and go to
   step 3 for the next item, same message. Asked for "more" → `explain`, but
   only because they asked.
5. After the last item: `submit-batch`.
6. Print `summaryLine`. Ask whether to continue.

`convention`, `prompt`, `grade`'s `say`, `summaryLine`, and the blocks from
`explain` and `tips` are all finished strings. **Print them
as they are** — don't compose your own, don't append, don't paraphrase.
Every one of them has been got wrong in a real session by being written out
by hand instead.

**Rules that apply to every item, no exceptions — check each reply against
these before sending, not just the first one:**

- **`item.prompt` is the entire question. Nothing before it, nothing after
  it.** No gloss, no type label, no `— meaning & reading?` tail — nor
  `— meaning + reading?`, which is that same tail with a different join and
  went on all twenty prompts of one session. `convention` said it once
  already. `取 (take)` hands over the answer; so do
  `心持ち (mindset)` and `ユ (Hook radical)`, and it makes no difference that
  the gloss is short, obvious or "just for clarity", because the meaning *is*
  what you're about to grade. Nothing goes in front either — `Batch 1/10.
  Starting:` is a preamble, and the number in the prompt is already the
  progress marker.
- **A glyph-less radical's `prompt` is an image URL. Print the URL.**
  `7. Rib Cage image` names the radical, which is the answer. A null `prompt`
  means there was no image either: say so and skip the item rather than
  describing it.
- **Every mid-batch message is the same two lines: a short verdict for the
  item they just answered, then the next prompt — and the prompt is last,
  full stop.** Nothing follows it: no answer, no guess at their answer, no
  hint. Send it, end your turn, wait. This holds when you know the answer
  cold, when the same item came up minutes ago (a `queue` call before the
  last batch was submitted hands back the same items), and on item 10 of 10.
  Recognising an item is not permission to fill it in: in one session item 4
  was printed, answered and graded inside a single message, so 当たり went in
  as a perfect score for a question nobody was ever asked. If you find
  yourself writing anything in the shape the user has been typing — a
  meaning, kana, romaji, "meaning, reading" — after a prompt, delete it
  before sending. That includes glossing the item you're about to ask about:
  `2. 転 — revolve, twist, turn over. Meaning + reading?` is the answer, the
  prompt, and the forbidden tail in one line.
  (The one exception: when `grade` comes back `open: true` the message ends
  with its `say`, because the item hasn't been answered yet and its prompt is
  still standing.)
- **What you say about a wrong answer is `grade`'s `say`, not your own
  words.** Writing the correction by hand is where romaji gets in:
  `should be "kaeru", not "sasaeru"` and `should be "shin", not "mi"` are
  both from real sessions, and so is `つぎつぎ is "tsugitsugu"` — romaji *and*
  misspelt, because it was transliterated from memory instead of read from
  the data. **And don't annotate the string once printed.** `Reading is
  はなし (hanashi)` and `Reading is じょう (jou)` are from a later session where
  the field *was* used and then decorated with a romaji gloss. The user
  typing romaji is not a reason to mirror it back; they can read the kana,
  which is the entire point.

  The kana-only rule governs anything you add in your own words too —
  verdicts, onyomi/kunyomi asides, recaps. The only romaji in a session is
  what the *user* types. The subtle leak: "it's あたり, not 回り" is fine, but
  "it's あたり, not mawari (that's 回り)" leaks it via the second word.

Each of these has gone wrong in practice. Treat them as a checklist, not
background reading.

### The steps in detail

1. **Fetch.** `node bin/wanikani.js queue --limit 10` — always JSON, no flag
   needed. Batches of ~10, not one at a time: there can be hundreds due, and
   a `queue` call per item wastes a round-trip when you already hold the next
   nine answer keys. Per item:

   - `prompt` — the question, printed as-is.
   - `subjectId` for `grade` and `explain`, `assignmentId` for `submit-batch`.
     Two different ids; the first names the *item*, the second names *your
     assignment of it*.
   - `subjectType`, `level`, `needsReading` — context, not answers.

   That's the whole payload: no meanings, no readings, no correction lines.
   (`--answers` puts them back for debugging this CLI. It is not a grading
   shortcut, and a session has no reason to pass it.)

   Re-run `queue --limit 10` when the batch is exhausted: submitting prunes
   those items, so it returns the next batch. Calling it *before* submitting
   hands back the same items, by design — nothing unsubmitted has been
   recorded anywhere.
2. **Empty queue**: say there's nothing due right now and stop.
3. **Ask, then let the CLI grade.** The first item of a sitting carries
   `convention`; the CLI decides when, so there's nothing to remember or
   suppress. After that it's `prompt` and nothing else, including for the
   meaning-only items (radicals, kana_vocabulary). When they answer:

   ```
   node bin/wanikani.js grade <subjectId> "parent, oya"
   ```

   Their reply goes in verbatim — the whole line, both halves, however they
   separated them (`,` `.` `;` `/` `|` `x` `、` or just a space) and in
   whichever order they typed it. Back comes:

   - `say` — the whole response: the correction line, the reading re-prompt,
     or `Reading?` when they gave a meaning and no reading. Print it as-is.
     Null means they got it and there's nothing to add beyond your own
     "Right."
   - `open` — true means the item is still waiting on them. Print `say`, end
     your turn, and grade their next reply against the same item. False means
     it's finished.
   - `wrongMeaning` / `wrongReading` — this attempt's misses, and `recorded`
     is the item's running total. Both are for reading, not bookkeeping: the
     counts go onto the sitting's record as they happen, and `submit-batch`
     reads them back. Nothing to carry in your head across ten items.
   - `parsed`, `meaning`, `reading` — which half it read as what, and how
     each graded. Worth a glance when a reply was oddly shaped.

   When a follow-up answers only one half, name it: `grade 3 --reading
   "shin"`. That's the usual shape after a `Reading?` or a re-prompt.

   It's a local call — cached subject, no API — so it costs a round-trip and
   no network.
4. **Override only where judgment beats the table.** `grade` holds the answer
   key, the IME spellings ("dzu" and "du" are both づ), WaniKani's refusal of
   Hepburn's *m* ("shimbun" is wrong for しんぶん), the blacklisted meanings
   that look plausible and aren't, and the rule that another real reading of a
   kanji is a re-prompt rather than a miss — the website shakes and names the
   type it wants, and so does this. Don't re-derive any of it from memory:
   it's the same code the interactive `review` command grades with, and it's
   why 親 answered "parent, oya" can't be marked wrong and slipped to
   Apprentice 4 again.

   What it can't know is whether "labratory" was a typo for the right answer
   or whether a synonym of theirs is fair. That judgment is yours, and it's
   the reason this skill drives the quiz instead of shelling out to `review`.
   When you overrule a miss, take it back off the record in the same breath:

   ```
   node bin/wanikani.js grade <subjectId> --forgive meaning
   ```

   (or `--forgive reading`). Say so in a short clause — "counting that as a
   typo" — and carry on. Skipping the `--forgive` is how a typo you forgave
   out loud still costs them a level at `submit-batch`.

   If `grade` itself errors, say so and stop the batch rather than falling
   back on memory. There's no answer key in the payload to fall back on, and
   memory is exactly what this replaced.
5. **A missed meaning ends the item.** `grade` already does this: it reveals
   both halves and closes the item rather than chasing a reading that almost
   never changes the outcome. Worth knowing so the behaviour doesn't look
   like a bug.

6. **"more" pulls up the item info — only when asked.** "more", "details",
   "why", "mnemonic", "tell me about that one", a bare "?" → run
   `node bin/wanikani.js explain <subjectId>`, print the block as-is, then
   re-print the open prompt so the batch picks up where it was.

   - **Run it — don't answer from memory, and don't decide there's nothing to
     show.** "Don't have mnemonic for that one", "No mnemonic on file" and a
     recollected paragraph in place of `explain 親` are all from one session,
     and all three were wrong: the command had the mnemonic, the parts and
     the links every time.
   - **Never run it unasked.** Most misses are a fat finger, and a mnemonic
     they didn't want is a wall of text between them and the next item.
   - **It means the item just graded**, not the prompt now open — that one
     would be handing over the answer. If they clearly mean the open item,
     say so and let them decide; if they still want it, run it.
   - **It changes no score.** The item was graded before they asked.
   - It also works between batches, after a session, and on characters
     (`explain 親`) rather than an id — which can match a kanji *and* a word,
     in which case it explains both and you print both.
7. **Auto-advance within a batch**: right or wrong, say so briefly and move
   into the next prompt in the same message — don't wait for "next". This
   only skips that round-trip after grading a *real reply*; it is never
   licence to answer the new prompt yourself. Pause only if they ask to slow
   down ("wait", "hold on", "explain that one"), and treat that as standing
   for the rest of the sitting. Between batches is different — see step 9.
8. **Submit the whole batch in one call.**

   ```
   node bin/wanikani.js submit-batch
   ```

   That submits exactly what `grade` recorded this batch — no list, no counts
   to remember, nothing to add up. Ten round-trips become one. If it comes
   back saying nothing was on record, that means the answers were never
   graded: the items are still due, and the fix is to grade them, not to
   assemble a list by hand. It prints `summaryLine` (step 9), `results[]` per
   item, `batch` counts, and `remaining`. If anything failed to submit,
   `summaryLine` already says so *and* says what becomes of it — print it and
   don't restate; `results[]` has the per-item error if they ask.

   If the session is interrupted before this call, nothing was sent for that
   batch: those items come back next time, nothing is double-counted.
9. **Between batches**, give the summary, then ask a brief "Continue?" rather
   than auto-chaining. Unlike within a batch, ask every time. On yes, `queue
   --limit 10` again; on no, or an empty queue, give the final summary and
   stop.

   `summaryLine` is printed as-is. It already names what changed status,
   carries the running session total, and drops segments that would say
   nothing:

   ```
   10 done, 8 perfect · 心強い → Guru, 集中 → Burned, 作業 slipped to Apprentice 1 · 30 done this session, 25 perfect · 127 left
   ```

   Summarising the summary loses exactly the parts worth having. This rewrite

   ```
   line:  10 done, 5 perfect · 工業 → Guru · 20 done this session, 10 perfect · 92 left
   typed: Batch 1 done. 5 perfect. 92 left.
   ```

   dropped the item that reached Guru and the session total. The separators,
   the wording and the drop-empty-segments rules are all already decided.

   Nor does a tally of your own belong *before* the call: one session
   announced "Batch 1 done — 8 perfect, 2 with errors" and then submitted a
   batch the record scored differently. The counting isn't yours to do, and
   saying it first only means saying it wrong first. Then wait: "Batch 2
   incoming…" is not the same thing as asking.

   Add a sentence of your own only for something the line can't know — a
   pattern worth naming ("the ん readings are the ones catching you").

Keep the pace conversational: one item's result plus the next prompt per
message, not a wall of text per batch, and keep every line short. The goal
is fewer *tool calls* and less waiting on "next" — not fewer chat turns.
Auto-advancing means more turns, back to back, which is the point.

## Telling them what it can do

A feature nobody knows about may as well not exist, and this one has form:
"more" sat unused because it lived in this file, and the lookup link went
unprinted for weeks. So the tool advertises itself, in code, and you print
it and get out of the way.

- **`node bin/wanikani.js tips`** prints the whole list of what the user can
  say. Run it on "what can I say?", "what else can you do?", "help", "tips",
  "is there a way to…". It needs no token and no network, so it answers even
  when nothing else will.
- **The convention note carries the pointer** — it ends with `or "what can I
  say?" for the rest`. That's the entire unsolicited advertisement.
- **Don't hand-roll tips and don't volunteer them.** If you're writing "by
  the way, you can also…", stop: either it's in `tips` and they can ask, or
  it isn't and it belongs in `lib/tips.js` — a code change, not something to
  improvise between two review items.

## Lessons

Teaching, not quizzing — so unlike reviews, everything is meant to be said
out loud: the characters, the meaning, the reading, the mnemonic.

1. `node bin/wanikani.js lessons --json --limit 5`. Batches of ~5; lessons
   are much heavier going than reviews. Each item has `assignmentId`,
   `characters` (null for glyph-less radicals — render `characterImageUrl`
   inline instead), `subjectType`, `level`, `meanings`, `readings`,
   `meaningMnemonic`/`meaningHint` and `readingMnemonic`/`readingHint`,
   markup already stripped. They arrive in WaniKani's teaching order, so take
   them in the order given — radicals before the kanji built from them. Empty
   array: say there's nothing to learn and stop.
2. One item per message: characters, meaning, reading (kana only — the
   no-romaji rule holds here too), and the mnemonic in your own words rather
   than read out. Tie it to a radical or kanji they've already had where the
   mnemonic does. Then ask if they've got it and wait — same rule as reviews,
   the question is the last thing in the message.
3. When they've got it, keep a list rather than shelling out. Once the batch
   is done, mark them all started in one call:

   ```
   node bin/wanikani.js start 551149968 603114625
   ```

   That's the non-interactive counterpart to `lessons --start`, which prompts
   per item and needs a real terminal — don't run that one. It prints
   `{results, batch}`; report anything that failed rather than assuming it
   went through. A 403 means the token is missing `assignments:start`.
4. Starting is what puts an item into the SRS: Apprentice 1, first review a
   few hours later (`firstReviewIn` says when). Mention that once at the end
   — "5 started, first reviews in 4h" — not per item. Anything they'd rather
   skip simply doesn't go in the `start` call and comes back next time.

## Status check

`node bin/wanikani.js summary [--json]` — level, lessons available, reviews
available, and time to the next review batch.
