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

Grading is a lookup against data `queue` already returned — it needs no
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
visible tool call and from there into transcripts — that's a leak. On "No
API token found", tell them to run `cp .env.example .env` and paste their
token into it (wanikani.com → Settings → API Tokens). Don't ask for the
token in chat, and don't type it yourself.

A 403 on a write is a missing permission checkbox on the token, not a
transient error: `reviews:create` for `submit`/`review`, `assignments:start`
for `start`. Name the box; don't retry.

## Reviews (the main flow)

Drive the quiz in chat rather than shelling out to the interactive `review`
command — you can use judgment on typos and phrasing that a rigid string
match rejects.

**The loop:**

1. `queue --limit 10`
2. Print the first item's `convention` if it has one.
3. Print `item.prompt`. Stop. Wait.
4. Grade. Wrong → the matching `corrections` line. One of the item's
   `otherReadings` → `readingNudge`, same item stays open. Asked for "more"
   → `explain`, but only because they asked. Then step 3 for the next item,
   same message.
5. After the last item: `submit-batch`.
6. Print `summaryLine`. Ask whether to continue.

`convention`, `prompt`, `corrections`, `readingNudge`, `summaryLine`, and
the blocks from `explain` and `tips` are all finished strings. **Print them
as they are** — don't compose your own, don't append, don't paraphrase.
Every one of them has been got wrong in a real session by being written out
by hand instead.

**Rules that apply to every item, no exceptions — check each reply against
these before sending, not just the first one:**

- **`item.prompt` is the entire question. Nothing before it, nothing after
  it.** No gloss, no type label, no `— meaning & reading?` tail: `convention`
  said that once already. `取 (take)` hands over the answer; so do
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
  Recognising an item is not permission to fill it in. If you find yourself
  writing anything in the shape the user has been typing — a meaning, kana,
  romaji, "meaning, reading" — after a prompt, delete it before sending.
  (The one exception: a `readingNudge` message ends with the nudge, because
  the item hasn't been answered yet and its prompt is still open.)
- **A wrong item is corrected with one of its `corrections` strings, not your
  own words.** Writing the correction by hand is where romaji gets in:
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

   - `prompt`, `corrections` (`meaning`/`reading`/`both`), and — when the
     item has other real readings — `otherReadings` and `readingNudge`. The
     finished strings; print, don't rebuild.
   - `assignmentId` for `submit-batch`, `subjectId` for `explain`.
   - `meanings`, `auxiliaryMeanings` (`whitelist` = also acceptable,
     `blacklist` = looks plausible but is wrong), `readings` (only
     `accepted_answer: true` is correct), `needsReading`. The raw answer key,
     for grading.

   Re-run `queue --limit 10` when the batch is exhausted: submitting prunes
   those items, so it returns the next batch. Calling it *before* submitting
   hands back the same items, by design — nothing unsubmitted has been
   recorded anywhere.
2. **Empty queue**: say there's nothing due right now and stop.
3. **Ask.** The first item of a sitting carries `convention`; the CLI decides
   when, so there's nothing to remember or suppress. After that it's `prompt`
   and nothing else, including for the meaning-only items (radicals,
   kana_vocabulary).

   Grade both parts out of one message — "fur, ke", "fur / ke", even "fur ke"
   — rather than making them answer twice. Whichever part looks like a
   reading (kana, or romaji per `readings`) is the reading; order doesn't
   matter. Meaning only, and right? Grade it and ask "Reading?" — worth the
   turn, they clearly know the item. Meaning wrong? Don't chase the reading:
   count both wrong, reveal both, move on. A follow-up there almost never
   changes the outcome.
4. **Grade** against the item's own data, not string equality: meaning
   against `meanings`/`auxiliaryMeanings` (accept reasonable synonyms and
   minor typos; reject any `blacklist` entry however plausible), reading
   against `readings`. Keep a running count of wrong attempts per item, per
   part.

   **Another of the item's real readings is not a wrong answer.** A kanji has
   two or three genuine readings and the prompt says nothing about which is
   wanted, so answering 親 with おや is an honest near-miss — and WaniKani
   doesn't count it: the input shakes, names the reading type it's after, and
   lets you try again. Do the same. Their reading in `otherReadings` → print
   `readingNudge`, don't add to `wrongReading`, don't reveal the kana, don't
   advance. In a real session 親 answered "parent, oya" was marked wrong and
   slipped to Apprentice 4; these two fields exist to stop that. A right
   meaning alongside an other-reading still grades as `wrongMeaning: 0`.

   Only items with other readings to be confused with carry those fields — a
   vocabulary word's rejected readings are misspellings (こころずよい for
   こころづよい), not alternatives, so those stay plain misses.

   A romaji reading is a *transcription*: convert it to kana and judge that,
   rather than comparing romaji spellings to each other. Any IME spelling
   landing on the same kana counts — du/dzu → づ, di/dzi/dji → ぢ, ji/zi → じ,
   hu/fu → ふ, n/nn → ん. Spellings that change the kana are still misses
   ("kokorozuyoi" misses こころづよい), but "kokorodzuyoi" is that same づ and
   marking it wrong is a mis-grade.

   One deliberate exception: traditional Hepburn's *m* before b/p/m is **not**
   accepted. "shimbun", "sempai" and "gumma" are wrong — WaniKani's own input
   turns them into しmぶん, せmぱい and ぐっま and marks them wrong, and being
   more generous here would put this tool out of step with their record.
5. **Correct** with the one line that fits: `corrections.reading` if only the
   reading missed, `corrections.meaning` if only the meaning did,
   `corrections.both` when the meaning went (which takes the reading with it,
   per step 3). Each is already whole — kana from the answer key, the reading
   type named for a kanji, a lookup link on the end:

   ```
   meaning is Parent · reading is しん (on'yomi) · https://jisho.org/search/親%20%23kanji
   ```

   Print one, print all of it, don't stitch two together, don't trim the link
   for brevity. That link used to be a separate field and went unprinted for
   weeks, which is why it's welded on now.
6. **"more" pulls up the item info — only when asked.** "more", "details",
   "why", "mnemonic", "tell me about that one", a bare "?" → run
   `node bin/wanikani.js explain <subjectId>`, print the block as-is, then
   re-print the open prompt so the batch picks up where it was.

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
8. **Submit the whole batch in one call.** Track `wrongMeaning`/`wrongReading`
   as you go rather than shelling out per item, then:

   ```
   node bin/wanikani.js submit-batch <<'EOF'
   [{"assignmentId": 551149968, "wrongMeaning": 0, "wrongReading": 1},
    {"assignmentId": 603114625, "wrongMeaning": 0, "wrongReading": 0}]
   EOF
   ```

   Ten round-trips become one. It prints `summaryLine` (step 9), `results[]`
   per item, `batch` counts, and `remaining`. If anything failed to submit,
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
