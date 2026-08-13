---
name: wanikani
description: Run a WaniKani lesson or review session from Claude Code, using the wanikani CLI in this repo to talk to the WaniKani API. Trigger on "/wanikani", "do my wanikani reviews", "wanikani lessons", or similar requests to study kanji via WaniKani.
---

# WaniKani study session

When invoked directly with nothing more specific ("/wanikani", "do my
wanikani reviews", etc.), go straight into the Reviews flow below — run
`summary`, then start fetching and quizzing. Don't stop to present a menu
of CLI subcommands and ask "which?"; only branch to Lessons or the plain
Status check if the user's own wording asked for one of those instead.

If plan mode is active when this skill is invoked, exit it immediately
instead of asking for confirmation — this is a direct-action skill (fetch
queue, quiz, submit reviews via the API), not a planning task, and there's
no code change here for plan mode to gate.

Grading a review item is a simple lookup against data the `queue` call
already returned (step 4 below) — it needs no deep deliberation. If the
current model/thinking setting is a slow, high-effort one, mention once at
the start of the first batch that a faster model or lower reasoning effort
(e.g. `/model`, `/fast`) will make the session noticeably snappier, since
grading doesn't benefit from extra thinking time. One line, then move on —
don't block the session on it or re-raise it later.

This repo is a small CLI (`bin/wanikani.js`) that talks to the WaniKani API
(https://api.wanikani.com/v2). It needs `WANIKANI_API_TOKEN` available to the
process.

**Never put the token value directly in a Bash command** (e.g.
`export WANIKANI_API_TOKEN=<value> && node ...`) — that value gets echoed
verbatim into the visible tool call, and from there into logs/transcripts,
so it's effectively a leak. Instead:

- Just run commands plain: `node bin/wanikani.js summary`. The CLI
  auto-loads a `.env` file from the repo root on startup if one exists (and
  doesn't override a `WANIKANI_API_TOKEN` already exported in the shell), so
  this works either way with no flags needed.
- If that still fails with "No API token found", there's no `.env` and
  nothing exported. Tell the user to run `cp .env.example .env` and paste
  their token into it (wanikani.com → Settings → API Tokens), then retry.
  Do not ask them to paste the token into the chat, and do not type it into
  a command yourself.

The token needs the `reviews:create` permission checked for `submit`/`review`
to work, and `assignments:start` for `lessons --start`. If a write call fails
with 403, that's almost certainly a missing permission checkbox on the token
(see README.md) — tell the user which one, don't just retry.

Run all commands from the repo root. Run `npm install` first if
`node_modules/wanakana` doesn't exist yet.

## Reviews (the main flow)

Drive the quiz yourself in chat, rather than shelling out to the interactive
`review` command — you can use judgment on typos/phrasing that a rigid string
match would reject, which is a better experience than the raw CLI.

**The whole loop:**

1. `queue --limit 10`
2. If the first item has a `convention` field, print it — that's the
   how-to-answer note, and it appears only at the start of a sitting.
3. Print `item.prompt`. Stop. Wait for their reply.
4. Grade it. Wrong? Print the matching `corrections` line — `meaning`,
   `reading` or `both` — whole, link and all. Gave one
   of the item's `otherReadings`? Print `readingNudge` instead and stay on the
   same item — that's a retry, not a miss. Asked for "more"? `explain` it,
   but only because they asked. Then step 3 for the next item, in the same
   message.
5. After the last item: `submit-batch`.
6. Print `summaryLine`. Ask whether to continue.

Four of those are strings the CLI hands you finished — `convention`,
`prompt`, `corrections`, `summaryLine`. **Print them as they are.** Don't
compose your own, don't append to them, don't paraphrase them into your own
words. Every one of them has been got wrong in a real session by being
written out by hand instead.

**Rules that apply to literally every item, no exceptions — re-check each
reply against these before sending it, not just the first one:**
- **`item.prompt` is the entire question. Nothing before it, nothing after
  it.** No gloss, no type label, and no `— meaning & reading?` tail: the
  `convention` field already said that once, so repeating it per item is
  noise, and it's what drags a gloss along behind it. `取 (take)` hands over
  the answer; so do `心持ち (mindset)` and `ユ (Hook radical)`, and it makes no
  difference that the gloss is short, obvious, or "just for clarity",
  because the meaning *is* what you're about to grade. Nothing goes in front
  of it either — `Batch 1/10. Starting:` is a position preamble, and the
  number in the prompt is already the progress marker.
- **A glyph-less radical's `prompt` is an image URL. Print the URL.** Never
  swap it for a description — `7. Rib Cage image` names the radical, which
  is exactly the answer being asked for, and it's worse than the gloss
  because it reads like a caption rather than a giveaway. If `prompt` is
  null there was no image either: say so and skip the item rather than
  describing it.
- **Every message you send mid-batch has the same two-line shape: a short
  verdict for the item they just answered, then that prompt line — and the
  prompt is the last thing in the message, full stop.** (The one exception is
  the reading re-prompt in step 4 — an item answered with another of its real
  readings hasn't been answered yet, so that message is the `readingNudge`
  alone and the same item stays open.) Nothing follows it:
  no answer, no guess at their answer, no hint. Send it, end your turn,
  wait. This holds even when you know the answer cold, even when the same
  item came up minutes ago (a `queue` call before the last batch was
  submitted hands back the same items), even on item 10 of 10. Recognizing an
  item is not permission to fill it in — grading needs their real,
  separately-sent reply, not your guess at it standing in for one. If you
  find yourself writing anything in the shape the user has been typing —
  a meaning, kana, romaji, "meaning, reading" — after a prompt, delete it
  before sending.
- **A wrong item is corrected with one of its `corrections` strings, not your
  own words.** Three keys, one whole line each: `corrections.meaning`,
  `corrections.reading`, `corrections.both`. Pick the one matching what they
  missed and print it entire — the lookup link is already the end of the line,
  so there's nothing to remember and nothing to append. (It used to be a
  separate `corrections.link` field, and in weeks of sessions it never once
  got printed. That's why it's welded on now; don't unpick it.) Writing
  the correction by hand is where romaji gets in: `should be "kaeru", not
  "sasaeru"` and `should be "shin", not "mi"` are both from a real session,
  and so is `つぎつぎ is "tsugitsugu"` — which is romaji *and* misspelt,
  because it was transliterated from memory instead of read from the data.
  **And don't annotate the string once you've printed it.** `Reading is
  はなし (hanashi)` and `Reading is じょう (jou)` are from a later session where
  the field *was* used and then decorated with a romaji gloss — the answer
  key was right there and correct, and a parenthesis undid it. The user
  typing romaji is not a reason to mirror it back; they can read the kana,
  which is the entire point of the exercise. The link on the end is a Jisho
  lookup — the kanji page for a kanji, the word page for vocabulary — or
  WaniKani's own page for a radical, and it's the one thing that makes a miss
  useful. Don't trim it off for brevity.

  For a kanji, `corrections.reading` names the reading type as well as the
  kana — `reading is しん (on'yomi)`. Print that parenthesis; it's the answer
  to "which of its readings did it want?", which is the thing a missed kanji
  reading actually leaves unanswered. It's also the only bracket that belongs
  there: it arrived in the string, it isn't romaji, and it's no precedent for
  adding one of your own.

  The kana-only rule still governs anything you add in your own words —
  verdict lines, onyomi/kunyomi asides, recaps. The only romaji in a session
  is what the *user* types. The subtle leak: "it's あたり, not 回り" is fine,
  but "it's あたり, not mawari (that's 回り)" leaks it via the second word.
These keep resurfacing in practice (they're each explained in more detail
below) — they're the most common way a review response goes wrong, so
treat them as a checklist, not just background reading.

1. Run `node bin/wanikani.js queue --limit 10` and parse the JSON — `queue`
   always prints JSON, with no flag needed. Fetch in
   batches of ~10 rather than one at a time (there can be hundreds due; one
   `queue` call per item wastes a round-trip per review for no benefit, since
   you already have the next 9 answer keys in hand). Each item has
   `assignmentId`, `subjectId` (what `explain` takes, per step 6),
   `prompt` (the finished question line — print it as-is),
   `corrections` (`meaning`/`reading`/`both` — one finished line each, link
   included, ready to print when they get it wrong), `needsReading`, `meanings`, `auxiliaryMeanings` (type `whitelist`
   = also acceptable, `blacklist` = looks plausible but is wrong), and
   `readings` (only the ones with `accepted_answer: true` are correct). An
   item that has other real readings also carries `otherReadings` (kana that
   should be re-prompted rather than marked wrong) and `readingNudge` (the
   finished re-prompt) — see step 4. The
   raw fields are there for grading; the composed ones are what you print.
   When the batch is exhausted, run
   `queue --limit 10` again — submitting prunes those items from the
   session's queue, so this returns the next batch, not repeats. (Calling it
   *before* submitting hands back the same batch again, by design: an
   unsubmitted item hasn't been recorded anywhere yet.)

   Glyph-less radicals are already handled: their `prompt` is the inline
   image WaniKani's own review screen shows. A null `prompt` means there was
   no image either — say so and skip the item rather than describing it,
   since any description gives the answer away.
2. If the queue is empty, tell the user there's nothing due right now and stop.
3. The first item of the first batch carries `convention` — print it, and
   that's the only time the how-to-answer note appears. The CLI decides when
   to include it (once nothing has been submitted this sitting), so there's
   nothing to remember or suppress. After that it's `prompt` and nothing
   else, for every item including the meaning-only ones (radicals,
   kana_vocabulary).

   A reply like "fur, ke" or "fur / ke" or even just "fur ke" on one line
   should grade both parts from that single message — don't make the user
   split it into two turns unless they want to. Parse whichever part looks
   like a reading (kana, or romaji per `readings`) as the reading and the
   rest as the meaning; order doesn't matter ("ke fur" works the same as
   "fur, ke"). If they only gave the meaning and got it right, grade that
   and ask "Reading?" as a quick follow-up — it's worth the extra turn since
   they clearly know the item. If the meaning was wrong, don't chase a
   reading separately: count it wrong too, reveal both in the correction,
   and move on — a missed meaning means asking for the reading in a follow-up
   turn is very unlikely to change the outcome, so it's not worth the
   round-trip.
4. Judge both parts against the item's own data, not exact string matching:
   meaning against `meanings`/`auxiliaryMeanings` (accept reasonable synonyms
   and minor typos; reject anything matching a `blacklist` entry even if it
   seems plausible), reading against `readings` (accept kana or romaji). Keep
   a running count of wrong attempts per item, per part.

   **Another of the item's real readings is not a wrong answer.** A kanji
   usually has two or three genuine readings and the prompt says nothing about
   which one is wanted, so answering 親 with おや is an honest near-miss, not a
   miss — and WaniKani doesn't count it as one: the input shakes, names the
   reading type it's after, and lets you try again. Do the same. If their
   reading matches one of the item's `otherReadings`, print that item's
   `readingNudge` (it already names the type) and wait for another attempt.
   Don't add to `wrongReading`, don't reveal the kana, don't advance to the
   next item — this is the one case where a reply that isn't the accepted
   answer still ends with the same prompt open. Marking it wrong instead costs
   them SRS progress the website would not have taken: in a real session 親
   answered "parent, oya" was graded wrong and slipped to Apprentice 4, which
   is the bug these two fields exist to prevent.

   If they sent meaning and reading together, the meaning still grades
   normally — a right meaning plus an other-reading is `wrongMeaning: 0` and,
   once they land the reading, `wrongReading: 0`.

   Only items with other readings to confuse them with carry `otherReadings`
   and `readingNudge`. A vocabulary word's rejected readings are misspellings
   (こころずよい for こころづよい), not alternatives, so the fields are absent
   there and those answers stay plain misses.

   A romaji reading is a *transcription*, not the answer itself: convert it
   to kana and judge that against `readings`, rather than comparing romaji
   spellings to each other. Accept any IME spelling that lands on the same
   kana — du/dzu → づ, di/dzi/dji → ぢ, ji/zi → じ, hu/fu → ふ, n/nn → ん.
   Differences that do change the kana are still misses (ず and づ really are
   different, so "kokorozuyoi" misses こころづよい), but "kokorodzuyoi" is that
   same づ spelled another way and marking it wrong is a mis-grade.

   One deliberate exception to that leniency: traditional Hepburn's *m*
   before b/p/m is **not** accepted. "shimbun" is wrong for しんぶん, as are
   "sempai" and "gumma" — WaniKani's own input converts those to しmぶん,
   せmぱい and ぐっま and marks them wrong, and grading them right here would
   put this tool's record out of step with the website. Correct them like
   any other miss (in kana, per the checklist).
5. When an item is wrong, print the one `corrections` line that fits:
   `corrections.reading` if only the reading missed, `corrections.meaning` if
   only the meaning did, `corrections.both` if the meaning went (a missed
   meaning takes the reading with it, per step 3). Each one is already a whole
   line ending in a lookup link — Jisho's kanji page for a kanji, its word
   page for vocabulary, WaniKani's own page for a radical. Print one, print it
   all, and don't stitch two of them together.

   Example, for a kanji whose meaning and reading both went:

   ```
   meaning is Parent · reading is しん (on'yomi) · https://jisho.org/search/親%20%23kanji
   ```
6. **"more" pulls up the item info — only when they ask for it.** Any of
   "more", "more info", "details", "why", "mnemonic", "tell me about that
   one", or a bare "?" after an item means: run

   ```
   node bin/wanikani.js explain <subjectId>
   ```

   with the `subjectId` from the queue item, and print the block it returns
   as-is (it's already formatted; same rule as `prompt` and `corrections`).
   Then re-print the open prompt so the batch picks up where it was.

   - **Never run it unasked.** Most misses are a fat finger or a blank, and a
     mnemonic they didn't want is a wall of text between them and the next
     item. The convention note tells them it exists; that's the whole
     advertisement it gets.
   - **"more" means the item just graded**, not the prompt now open — asking
     about the open one would hand them the answer. If they clearly do mean
     the open item, say that it gives the answer away and let them decide;
     if they say yes anyway, run it. It's their session.
   - **It changes nothing about the score.** The item was already graded when
     they asked; `wrongMeaning`/`wrongReading` stay exactly as they were.
   - It works between batches and after a session too, and it takes characters
     as well as a subject id (`explain 親`) — handy when they ask about
     something from earlier that isn't in the current batch. Characters can
     match two subjects (親 is a kanji and a word); the command explains both,
     so print both.
7. **Auto-advance within a batch**: whether an item was right or wrong, say
   so briefly and move straight into the next item's prompt in the same
   message — don't wait for the user to say "next" or "continue" between
   items. This only ever skips the "next"/"continue" round-trip after
   *grading a real reply* — it is never license to answer the new prompt
   yourself and grade that; the item you just advanced to still needs the
   user's own reply before it can be graded (see the checklist above).
   Only pause the advance if the user explicitly asks to slow down,
   review an answer, or stop (e.g. "wait", "hold on", "explain that one") —
   treat that as a standing preference for the rest of the session once
   they've said it, not a one-off. This only applies *within* a batch —
   between batches, see step 9.
8. Track each item's `wrongMeaning`/`wrongReading` counts in your own head as
   you go — don't shell out per item. Once the whole local batch (all ~10)
   has been quizzed, submit it in **one** bash call via `submit-batch`,
   piping a JSON array on stdin:
   ```
   node bin/wanikani.js submit-batch <<'EOF'
   [{"assignmentId": 551149968, "wrongMeaning": 0, "wrongReading": 1},
    {"assignmentId": 603114625, "wrongMeaning": 0, "wrongReading": 0}]
   EOF
   ```
   This collapses ~10 round-trips into 1. It prints:
   - `summaryLine` — the finished end-of-batch line, names and running
     totals included. Print it as-is; step 9 is about when, not how.
   - `results[]` — per item, `{assignmentId, ok, perfect, startingSrsStage,
     endingSrsStage, srsStageName, srsTier, tierChange}`, or
     `{ok: false, error, retryable}` if that item didn't submit.
   - `batch` — `{submitted, failed, perfect, burned, promoted, demoted}`.
   - `remaining` — reviews still due after this batch.

   Check for any `ok: false` entries and tell the user if something failed to
   submit; don't assume success silently. A `retryable` failure stays in the
   queue and comes back in a later batch, so it isn't lost; a non-retryable
   one (WaniKani rejected it outright — usually because that assignment was
   already reviewed elsewhere) is dropped, and that item's result simply
   didn't count.

   Tradeoff to be aware of: if the session is interrupted mid-batch (before
   the `submit-batch` call runs), nothing has been sent to WaniKani yet for
   that batch — the user just re-answers those items next time, nothing is
   corrupted or double-counted.
9. After submitting, give the batch summary, then ask a brief yes/no before
   fetching more — e.g. "Continue?" — rather than auto-chaining into the next
   batch. Unlike within-batch advancing, don't treat a stop-word as a standing
   preference here; ask every time. On yes, run `queue --limit 10` again and
   keep going; on no (or the queue comes back empty), give the final summary
   and stop.

   The summary is `submitBatch`'s `summaryLine`, printed as-is — it already
   names what changed status, carries the running session total, and drops
   the segments that would say nothing:

   ```
   10 done, 8 perfect · 心強い → Guru, 集中 → Burned, 作業 slipped to Apprentice 1 · 30 done this session, 25 perfect · 127 left
   ```

   Paste that line; don't rewrite it. Summarising the summary loses the
   parts that make it worth having, every time it's been tried:

   ```
   line:  10 done, 5 perfect · 工業 → Guru · 20 done this session, 10 perfect · 92 left
   typed: Batch 1 done. 5 perfect. 92 left.
   ```

   That rewrite dropped the item that reached Guru and the whole session
   total — the two things the line exists for. An earlier one turned
   `4 moved up, 1 slipped back` into "4 promoted, 1 demoted", which is the
   same facts in a worse format. The separators, the wording and the
   drop-empty-segments rules are all already decided.

   Add a sentence of your own only when there's something the line can't
   know — an item that failed to submit and why, or a pattern worth naming
   ("the ん readings are the ones catching you").

Keep the pace conversational — one item's result + the next item's prompt
per message, not a wall of text for the whole batch at once, and keep every
prompt (item prompts, the convention note, the between-batch check) as
short as possible. The goal is fewer *tool calls* and less *waiting on the
user for "next"*, not fewer or shorter chat turns — auto-advancing means
more turns happen back-to-back, which is the point.

## Telling them what it can do

A feature nobody knows about may as well not exist, and this one has form:
"more" sat unused because it lived in this file, and the lookup link went
unprinted for weeks. So the tool advertises itself, and the rules for that
are the same as everywhere else here — the strings are composed in code, and
your job is to print them and then get out of the way.

- **`tips`** — `node bin/wanikani.js tips` prints the whole list of what the
  user can say. Run it whenever they ask anything in that shape: "what can I
  say?", "what else can you do?", "help", "tips", "is there a way to…". Print
  the output as-is; it's already formatted. It needs no token and no network,
  so it answers even when nothing else will.
- **The convention note names it** — the once-a-sitting line ends with `or
  "what can I say?" for the rest`, which is the entire unsolicited
  advertisement the feature list gets. Print the note and leave it there.
- **Don't hand-roll your own tips, and don't volunteer them.** If you find
  yourself writing "by the way, you can also…", stop: either it's in `tips`
  already and they can ask, or it isn't and it belongs in `lib/tips.js` —
  a code change, not something to improvise mid-session. Advice nobody asked
  for between two review items is exactly the noise this is arranged to
  avoid.

## Lessons

Teaching, not quizzing — so unlike reviews, everything is meant to be said
out loud. Show the characters, the meaning, the reading, the mnemonic.

1. Run `node bin/wanikani.js lessons --json --limit 5` and parse the JSON.
   Batches of ~5: lessons are much heavier going than reviews. Each item has
   `assignmentId`, `characters` (null for glyph-less radicals — render
   `characterImageUrl` inline, same as in reviews), `subjectType`, `level`,
   `meanings`, `readings`, `meaningMnemonic`/`meaningHint`, and
   `readingMnemonic`/`readingHint` (markup already stripped). They come back
   in WaniKani's own teaching order, so take them in the order given —
   radicals before the kanji built from them. If the array is empty, say
   there's nothing to learn right now and stop.
2. Teach one item per message: the characters, what it means, how it's read
   (kana only — the no-romaji rule holds here too), and the mnemonic in your
   own words rather than read out verbatim. Tie it back to a radical or kanji
   they've already had where the mnemonic does. Then ask if they've got it,
   and wait — the same "the prompt is the last thing in your message" rule
   applies: don't answer for them and don't teach the next item in the same
   message.
3. When they say they've got it, don't shell out yet — keep a list. Once the
   batch is done (or they want to stop), mark them all started in one call:

   ```
   node bin/wanikani.js start 551149968 603114625
   ```

   That's the non-interactive counterpart to `lessons --start` (which prompts
   per item and needs a real terminal, so don't run that one). It prints
   `{results, batch}` — per item `{assignmentId, ok, srsStageName,
   firstReviewIn}`, or `{ok: false, error, retryable}`. Report anything that
   failed rather than assuming it went through.
4. Starting a lesson is what puts the item into the SRS: it enters Apprentice
   1 and the first review lands a few hours later (`firstReviewIn` says
   when). Mention that once at the end — "5 started, first reviews in 4h" —
   not per item. Only items they've actually learned should be started;
   anything they want to skip just doesn't go in the `start` call, and comes
   back as a lesson next time.

`start` needs the token's `assignments:start` permission. A 403 here means
that box isn't checked — say so rather than retrying (see README.md).

## Status check

`node bin/wanikani.js summary [--json]` — level, lessons available, reviews
available, and time to next review batch.
