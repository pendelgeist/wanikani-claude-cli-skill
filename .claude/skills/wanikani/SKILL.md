---
name: wanikani
description: Run a WaniKani lesson or review session from Claude Code, using the wanikani CLI in this repo to talk to the WaniKani API. Trigger on "/wanikani", "do my wanikani reviews", "wanikani lessons", or similar requests to study kanji via WaniKani.
---

# WaniKani study session

Invoked with nothing more specific ("/wanikani", "do my wanikani reviews"),
go straight into Reviews below — `summary`, then fetch and quiz. Don't offer
a menu of subcommands; branch to Lessons or the Account check only if their
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

**This CLI is the WaniKani client. Don't write another one.** No `curl` at
the API, no scripts in `/tmp` against `/v2/subjects` — one session did exactly
that and it cost it the batch (see below). If something you need genuinely
isn't here, that's a change to `lib/`, proposed to the user, not a script
written mid-review.

**Run them plain — no `2>/dev/null`, no `| jq`.** stderr is where this CLI
says a call was refused and why; a session that suppressed it on every `queue`
call spent the rest of the sitting inferring what had happened, and inferred
wrong. `jq` is the other half of the same problem: `queue … | jq '.[30:]'`
throws away the shape of the payload and takes a slice the CLI doesn't know
about. Read the output as it comes.

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
match rejects. `review` is a person's terminal UI, not a fallback for this
flow: don't run it, and don't pipe answers into it.

**Grading doesn't happen in chat. It happens in `grade`, as each reply
arrives** — not at the end, and not from an answer key you went and got
yourself. `queue` returns the questions and no answers, but that's a nudge,
not a wall: the token is in the environment and the API is public, and a
session proved it by writing `/tmp/fetch_subjects.js` to pull the meanings and
readings for its ten items and then grading all ten in chat from them. What
that bought was ten unrecorded verdicts, four hand-written corrections in
romaji, a `submit-batch` with nothing to submit, and every item graded a
second time through `grade` anyway. The key was never the missing piece — the
record is. `grade` is what records, and `submit-batch` submits the record and
nothing else. A session that answered ten items in chat first found
`submit-batch` had nothing to submit, tried to reconstruct the batch
afterwards, tangled it, and concluded the tool didn't support the workflow.
It does; the answers just have to go through it. If you ever find yourself
there: grade the answers you still have, one call each, then submit. Nothing
is lost until the items are re-answered.

The verdicts in that session were the other half of the damage. Ten answers
came back `✓ Correct` in chat before any of them had been graded; when the
same ten went through `grade` minutes later, four were wrong. There is no
reading of the payload that makes a chat verdict possible — the answers
aren't in it — so a `✓` you didn't get from `grade` is a guess, and it
guessed wrong four times out of ten.

`grade` holds the key, records the
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
4. `grade <subjectId> "<their whole reply>"`. Print what it prints — for a
   closed answer that's the verdict *and* the next item's prompt, which is the
   whole message. `open: true` → the same item is still waiting, and the
   output stops at `say`. Asked for "more" → `explain`, but only because they
   asked.
5. After the last item: `submit-batch`.
6. Print `summaryLine`. Ask whether to continue.

Steps 3 and 4 have a whole-batch form — `prompts` and `grade-many`, once
they've asked for it. See *Rapid-fire* below; everything else on this page
applies to it unchanged.

`convention`, `prompt`, the block from `prompts`, `grade`'s and `grade-many`'s
verdict lines, `summaryLine`, and the blocks from `explain` and `tips` are all
finished strings. **Print them as they are** — don't compose your own, don't
append, don't paraphrase. Every one of them has been got wrong in a real
session by being written out by hand instead.

**Rules that apply to every item, no exceptions — check each reply against
these before sending, not just the first one:**

- **`item.prompt` is the entire question. Nothing before it, nothing after
  it.** The tail has now been tried in three spellings — `— meaning & reading?`,
  `— meaning + reading?`, and `— meaning and reading?` on all twenty prompts of
  one session — so the rule is the shape, not the wording: the message ends
  where `prompt` ends. No gloss, no type label, no example answer
  (`(e.g. "side, yoko")` opened one session by answering its own first item).
  `convention` said all of that once already. `取 (take)` hands over the answer;
  so do `心持ち (mindset)` and `ユ (Hook radical)`, and it makes no difference
  that the gloss is short, obvious or "just for clarity", because the meaning
  *is* what you're about to grade. Nothing goes in front either — `Batch 1/10.
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
  still standing. Rapid-fire keeps the same shape at batch scale — the verdict
  lines, then the list of what's still open, and the list is last.)
- **What you say about a wrong answer is `grade`'s `say`, not your own
  words — and `grade` now prints the whole message, so there is nothing left
  to compose.** After a closed answer its output is the verdict, a blank line,
  and the next item's prompt: send that block, end your turn. This exists
  because composing the message around the line is where the line gets
  rewritten. One sitting did it on all eleven of its misses — `Reading is
  tsugi.` for `つぎ`, `Meaning is Parent, reading oya.` for `おや`, `reading
  zo` for `ぞう`, which is also just wrong — and dropped every lookup link on
  the way. Nothing in those messages was worth the typing: the CLI had already
  said it, in kana, with the link.

  The rest of the rule stands for everything the block doesn't cover: Writing the correction by hand is where romaji gets in:
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

- **An open item ends at `say`, and `say` is deliberately answerless.** The
  on'yomi re-prompt names the *type* WaniKani wants and no kana, because the
  item is still live. `Reading is kunyomi (uma), need on'yomi. Hint: ba.` and
  `Hint: suu.` are from one session: both handed over the answer and both were
  then typed back and marked correct. `Need on'yomi — try じ (ji)?` is the same
  move in a politer shape, from a later one, and it went the same way. If you
  are adding a hint to a question they haven't answered, you are answering it —
  and a question mark on the end doesn't make the kana any less legible.

- **A miss ends the item — there is no retry.** `grade` prints `(recorded —
  next item)` under a correction to say so. `Retry?` went out after nearly
  every wrong answer of one session; the extra round changes no score (the miss
  is already on the record, and WaniKani doesn't offer one either), it reads to
  the user as a recovery that didn't happen, and in one case the session typed
  the retry *itself* — `grade 761 "ka"` — right after being told to submit as
  is. Print the correction, move to the next prompt.

  **And the retry is usually a hand-over as well**, which is what makes it
  worth its own paragraph. The correction *contains the answer* — that's its
  job — so anything you write after it is written from the reveal. One session
  did this six times: `✗ meaning is Public Official / Government Official` was
  followed by `Try "public official"?`, the user typed it back, and it printed
  `✓ Correct` over a miss that was already recorded. Six items, six
  answers handed over, six false verdicts. `grade` now refuses a second answer
  to a settled item and says what's on the record instead — but the refusal is
  a backstop, not the rule. The rule is that the correction is the last word on
  that item.

- **Don't count the batch. `submit-batch` counts it.** `Batch complete: 8
  perfect, 2 with errors. Submitting…` went out ahead of eight consecutive
  submissions in one session and disagreed with the record in at least three of
  them. There is nothing to tally: the counts are in the file, and the line
  that reports them arrives a second later. A tally with no `submit-batch`
  under it is worse still — `Session total: 30 items (3 batches) — Batch 1: 6
  perfect, 4 corrected…` was typed out by a session that had submitted nothing
  at all, and two of its three batch tallies didn't add up to ten. Every number
  in it was invented, including the ones that happened to be right.

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
   hands back the same items and would discard whatever was graded for them —
   asking an item is asking it fresh — so it now refuses while anything is
   graded and unsubmitted, and names `submit-batch`. Do that; don't re-fetch
   mid-batch to "check" something. The batch you're holding is the batch
   you're answering. (`--restart` throws the record away on purpose. It is for
   a batch that really should be asked again, not for getting past the
   refusal.)

   **The same ten items coming back is the queue working, not the API
   lagging.** Nothing is pruned until it's submitted, so an unsubmitted batch
   is still the batch that's due. A session that read it as lag answered those
   ten a second time, and a third batch after that, and submitted none of the
   thirty: three sittings' worth of answers, no reviews recorded, and a running
   total reported to the user that described none of it. Nor is slicing the
   fetch a way round it — `queue --limit 20 | jq '.[10:]'` re-serves twenty
   items as the batch, so `prompts`, `grade-many` and `submit-batch` are all
   now talking about a different set than the one on screen. That session went
   on to `--limit 40 | jq '.[30:]'` and then `--limit 50`, and each of those
   calls cleared every grade recorded since the last submit: five batches
   answered, one submitted, and the CLI blamed for it.
2. **Empty queue**: say there's nothing due right now and stop.
3. **Ask, then let the CLI grade.** The first item of a sitting carries
   `convention`; the CLI decides when, so there's nothing to remember or
   suppress. After that it's `prompt` and nothing else, including for the
   meaning-only items (radicals, kana_vocabulary). When they answer:

   ```
   node bin/wanikani.js grade <subjectId> "parent, oya"
   ```

   Their reply goes in **verbatim** — the whole line, both halves, however
   they separated them (`,` `.` `;` `/` `|` `x` `、` or just a space) and in
   whichever order they typed it. Don't tidy it on the way in: a session
   swapped a full stop for a comma harmlessly for a while and then turned
   `page. pe-ji` into `page, peji`, which is a different word — the answer was
   right and the hyphen was load-bearing. Copy the line; the CLI knows what to
   do with it. What comes back is **the line to say**, and
   saying it is the whole job:

   ```
   ✓
   ✗ reading is しん (on'yomi) · https://jisho.org/search/親%20%23kanji
   That's a real reading, but WaniKani wants the on'yomi here — try again.
   (same item — still their turn)
   ```

   Print it. Don't restate it, don't translate the kana, don't add a romaji
   gloss in brackets: `Reading: かる (karu)`, `correct is どうろ (douro)` and
   `correct is え (e)` are all from one session where the right line was
   printed by the CLI and retyped by hand anyway, and one of them came out
   misspelt. The kana is the answer; the romaji is noise.

   `(same item — still their turn)` means end your turn there and grade their
   next reply against the same item. A line starting `!` is a problem to read,
   not a verdict — `NOT RECORDED` in particular means `submit-batch` won't see
   this answer, and continuing past it wastes the batch.

   `--json` adds the full verdict — `parsed`, `recorded`, per-part statuses —
   when something needs inspecting. Normal answering doesn't.

   A follow-up needs nothing special: after `Reading?` or a re-prompt the item
   is waiting on a reading, and `grade 3 "shin"` is graded as one. (`--reading`
   and `--meaning` are still there for naming a half outright.)

   It's a local call — cached subject, no API — so it costs a round-trip and
   no network.
4. **Override only where judgment beats the table.** `grade` holds the answer
   key, the IME spellings ("dzu" and "du" are both づ; "shinyuu" is read both
   as しんゆう and しにゅう, since romaji can't tell them apart without an
   apostrophe), WaniKani's refusal of Hepburn's *m* ("shimbun" is wrong for
   しんぶん), the blacklisted meanings
   that look plausible and aren't, and the rule that another real reading of a
   kanji is a re-prompt rather than a miss — the website shakes and names the
   type it wants, and so does this. Don't re-derive any of it from memory:
   it's the same code the interactive `review` command grades with, and it's
   why 親 answered "parent, oya" can't be marked wrong and slipped to
   Apprentice 4 again.

   Ordinary typos it now handles too, the way the website does: a slip or two
   in a meaning ("goverment official", "pubilc official") grades as correct
   rather than as a miss. That closes the trap where a right answer came back
   ✗, the correction revealed the meaning, and the session then read it out
   for the user to type back.

   What it can't know is whether a mangling well past a typo was meant as the
   right answer, or whether a synonym of theirs is fair. That judgment is
   yours, and it's the reason this skill drives the quiz instead of shelling
   out to `review`.
   When you overrule a miss, take it back off the record in the same breath:

   ```
   node bin/wanikani.js grade <subjectId> --forgive meaning
   ```

   (or `--forgive reading`). Say so in a short clause — "counting that as a
   typo" — and carry on. Skipping the `--forgive` is how a typo you forgave
   out loud still costs them a level at `submit-batch`.

   If `grade` itself errors, or warns that an answer wasn't recorded, say so
   and sort it out before carrying on — a batch answered on top of that
   warning is a batch `submit-batch` can't submit. There's no answer key in
   the payload to fall back on, and memory is exactly what this replaced.
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
   - **Print the block, don't re-typeset it.** A later session ran `explain`
     properly and then rewrote its output with romaji in brackets — `かる
     (karu)`, `ぶつ (butsu)`, `けってん (kettten)`, that last one misspelt.
     The block is finished text.
   - **Deflecting still isn't glossing.** When a "more" is unclear or belongs
     to an item you can't identify, ask which one — `Item 5 is フランス語
     (French language). Give meaning and reading?` answered the question it
     was standing in front of.
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
   assemble a list by hand. It takes no list on stdin either: one session fed
   it `<<'EOF' [{"assignmentId": …, "wrongMeaning": 0}] EOF` on all eight of
   its batches, and every one of those went in the bin — it now says so out
   loud rather than looking accepted, in the payload as well as on stderr,
   because a later sitting did the same on all six of its batches without ever
   mentioning the warning. `ignoredStdin` in the result means the submission
   was still right and the heredoc was the part that did nothing. It prints `summaryLine` (step 9), `results[]` per
   item, `batch` counts, and `remaining`. If anything failed to submit,
   `summaryLine` already says so *and* says what becomes of it — print it and
   don't restate; `results[]` has the per-item error if they ask.

   Two things it deliberately leaves behind. An item still mid-question — a
   re-prompt nobody answered — isn't submitted, because the half that could be
   wrong hasn't been given; it stays due. And anything asked but never graded
   is counted in `summaryLine` as `left unanswered — still due`, which is the
   line's way of showing the gap between what went past on screen and what
   reached the record. If that segment appears and you weren't expecting it,
   some answers didn't go through `grade`.

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
   pattern worth naming ("the ん readings are the ones catching you"). And
   then wait: "Batch 2 incoming…" is not the same thing as asking.

### When you've lost track of what landed

A sitting lives in a file, not in a conversation: it survives for 30 minutes
of idleness, so a new session can walk into one already half-answered, with
the one-off notes already said to somebody else. **When you arrive and the
state isn't obvious, look before you fetch** — a `queue` call is not a free
question.

`node bin/wanikani.js status` answers it: how many of the batch are asked,
answered and still open, how many answers are on record and unsent, what's
been submitted this sitting, and the next call to make. It reads the local
record — no token, no network — so it answers when nothing else does. Run it
when the state is unclear, when a `submit-batch` says something you weren't
expecting, and whenever they ask "did that go through?".

- **Don't theorise about the tool. Ask it.** "CLI grading/submission system
  seems partial/inconsistent", "Tool only accepted batch 5", "CLI broken",
  "This one's unreliable — use the WaniKani web interface" all went to a user
  in one sitting. The actual cause was that session's own `queue --limit 40`
  calls, each of which cleared the record it then found empty; every number
  needed to see that was one `status` away. A tool verdict is the last thing
  to reach for and the first thing that gets typed.
- **"Nothing was submitted" is not "your answers are lost".** An item stays
  due until it's submitted, so an unsubmitted batch is a batch still waiting
  to be answered — not forty items owed to a website. Say that, because the
  alternative reads as an hour of work destroyed. Every message that reports
  an empty record says it too; it keeps not being read.
- **The numbers in a prompt are positions in one fetch, not names.**
  Submitting prunes what went in, so the next fetch's "31" is a different item
  from the last one's, and `queue` handing back something unfamiliar means the
  list moved, not that reviews went missing. "Remaining 20 from your original
  work are gone from queue" was the conclusion drawn from that in one session;
  those twenty were sitting in the queue, still due, at different positions.
- **Don't rebuild a lost batch from the chat log.** After a wipe the
  temptation is to replay the answers upward in the transcript. Half of them
  aren't theirs: the session that did this re-graded thirty items using the
  corrected answers it had fed the user after each miss. It reported three
  batches of "10/10 perfect" — fourteen of those thirty had been missed
  minutes earlier, and four items were *burned*, out of the review cycle for
  good, on answers the user never gave. The items were all still due. Ask them
  again — that's what "still due" means — or move on and let WaniKani bring
  them back. The recovery in the paragraph above is for answers *they* gave
  this batch that never reached `grade`, and only those.

  (`submit-batch` now carries a miss across a re-ask within the same sitting,
  so this can't quietly promote anything any more. That's a floor under the
  damage, not permission: it still asks them nothing and tells them a batch
  went perfectly when it didn't.)

- **One `grade` call per reply, in the turn the reply arrives.** A shell loop
  over a list of answers — `for subjectId in 3504 616 …; do grade $subjectId
  "…"; done` — is by construction not that: nobody typed anything while it
  ran. It was the shape the replay above took, and the shape is the tell. The
  legitimate whole-batch form is `grade-many`, which grades one message the
  user actually sent.

### Drilling recent mistakes

"Let's re-review my recent mistakes", "quiz me on what I got wrong", "drill
the ones I missed" → `node bin/wanikani.js drill [--limit N]`. It returns the
items recently answered wrong, as questions, in the same shape `queue` uses:
a `prompt` and a `subjectId`, no answers. Ask them one at a time and grade each
through `grade`, exactly as in a batch.

- **The list comes from the record, never from the conversation.** Asked this
  before the command existed, a session scrolled back through the transcript,
  assembled nineteen items from what it remembered of them, and quizzed and
  graded all nineteen from memory — romaji corrections, invented verdicts, and
  a hint handed over when the user typed `x.x`. Every one of those items was
  in the record, misses and all.
- **Nothing in a drill is due and nothing submits.** `grade` says so —
  `(drill — nothing recorded, nothing submitted)` — because the items were
  submitted when their batch was. Say it once at the start so they know the
  drill costs and earns nothing; it's practice.
- **Everything else is the same**: prompts printed as they come, verdicts from
  `grade`, no hints, no answers before they've answered.

Keep the pace conversational: one item's result plus the next prompt per
message, not a wall of text per batch, and keep every line short. The goal
is fewer *tool calls* and less waiting on "next" — not fewer chat turns.
Auto-advancing means more turns, back to back, which is the point.

### Rapid-fire: a whole batch in one exchange

Once someone has their pace, one item per message *is* the slow part. So the
batch can go out as a list and come back as a list — a real session ran nine
items in one exchange that way, and the user asked for the next batch the
same. Two commands, and the point of both is that nothing is composed from
memory:

1. `node bin/wanikani.js prompts` — every still-unanswered item in the batch,
   numbered as `queue` numbered it, as one block. Print it as it comes; the
   how-to line under it is part of it, and the CLI decides when to include it
   (once a sitting), so there's nothing to remember or suppress.
2. They answer them in one message, separated by `|`.
3. `node bin/wanikani.js grade-many "<their whole line>"` — the reply goes in
   **verbatim**, same as `grade`: don't tidy it, don't reorder it, don't drop
   the empty slots. It grades in order and prints one numbered verdict line per
   item, then what's still open.
4. Some items come back open — a re-prompt, or ones they skipped. `prompts`
   again lists just those, keeping their original numbers, and their next line
   goes through `grade-many` again. When nothing is open, `submit-batch`.

**Never write the list yourself.** This is the one that ended a session: asked
for the remaining nine, it typed out `shore/kishi |
city/town/village/shichouchouson | get ahead/sakimawari | …` — nine meanings
and readings recalled from memory, two of them wrong, handed to the user as the
question. `prompts` exists so there is nothing to recall. **If you are about to
type a numbered list of items into chat, stop — that list is the batch's answer
key.** The same goes for `grade-many`'s side: don't hand-map their answers to
subject ids across nine `grade` calls, because that mapping is counting, and
counting nine items deep into a batch is what the command is for.

If `grade-many` refuses ("4 answers for 3 open items — nothing graded"), print
what it said and let them re-send. It refuses because `|` also separates the
halves of a single answer, and a guess there marks every item after the split
against its neighbour's answer key.

**When to switch.** They ask for it — "rapid fire", "faster", "all at once",
"the rest in one go" — or they answer several items in one message unasked,
which is the same request. It holds for the rest of the sitting, the way
"wait" holds the other way; "one at a time" turns it off. You may offer it
once, between batches, in a clause — never mid-batch, and never twice.

**What doesn't change.** The verdict lines are `grade-many`'s, printed as they
come, kana and links intact. A miss is still a miss with no retry. The batch
still ends at `submit-batch`, and you still ask before starting the next one.

## Telling them what it can do

A feature nobody knows about may as well not exist, and this one has form:
"more" sat unused because it lived in this file, and the lookup link went
unprinted for weeks. So the tool advertises itself, in code, and you print
it and get out of the way.

- **`node bin/wanikani.js status`** answers "did that go through?", "what's
  left?", "is that submitted?" — from the record rather than from memory. See
  *When you've lost track of what landed* above; it needs no token either.
- **`node bin/wanikani.js tips`** prints the whole list of what the user can
  say. Run it on "what can I say?", "what else can you do?", "help", "tips",
  "is there a way to…". It needs no token and no network, so it answers even
  when nothing else will.
- **The convention note carries the pointer** — it ends with `or "what can I
  say?" for the rest`. That, plus the single rapid-fire offer above, is the
  whole of what a session brings up unasked.
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

## Account check

`node bin/wanikani.js summary [--json]` — level, lessons available, reviews
available, and time to the next review batch. That's the account; `status` is
the sitting's own record, above.
