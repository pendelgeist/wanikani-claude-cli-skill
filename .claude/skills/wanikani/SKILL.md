---
name: wanikani
description: Run a WaniKani review session from Claude Code, using the wanikani CLI in this repo to talk to the WaniKani API. Trigger on "/wanikani", "do my wanikani reviews", "quiz me on kanji", or similar requests to review kanji via WaniKani. Reviews only — lessons are done on wanikani.com.
---

# WaniKani study session

Invoked with nothing more specific ("/wanikani", "do my wanikani reviews"),
go straight into Reviews below. Don't offer a menu; branch to the account
check only if their own wording asked for one. If plan mode is
active, exit it immediately rather than asking: this is ask-answer-repeat,
not a code change for plan mode to gate.

Most of a review turn is one CLI call and no deliberation. If the current
model or reasoning effort is a slow one, say once at the start that `/model`
or `/fast` makes the session snappier, then drop it.

## Running the CLI

Every command below is written `wanikani <command>`, which is what it is once
the repo has been `npm link`ed — and that is the form to use, because this
skill is usually installed outside the repo and a relative path wouldn't
resolve from wherever the session happens to be. If `wanikani` isn't found,
fall back to `node <path-to-repo>/bin/wanikani.js <command>` and say so once,
so it can be put on the PATH properly. Either way it needs
`WANIKANI_API_TOKEN`; the CLI auto-loads the repo's own `.env` whatever
directory it's run from, so nothing needs passing in. Run `npm install` in the
repo first if `node_modules/wanakana` doesn't exist.

**Run it from wherever you already are.** No `cd` — not into the repo, not
into the skill directory. The command is on the PATH and the working
directory has no bearing on any of this; one sitting prefixed every single
call with a `cd` into the skill folder, which did nothing except reset the
shell afterwards.

- **This CLI is the WaniKani client. Don't write another one.** No `curl` at
  the API, no scripts in `/tmp` against `/v2/subjects`. One session did
  exactly that to get the answer key, graded ten items in chat from it, and
  ended the batch with nothing submittable. If something you need genuinely
  isn't here, that's a change to `lib/`, proposed to the user.
- **Nothing between the command and the screen.** No `2>/dev/null`, no `| jq`,
  no `| head`. stderr is where a refusal explains itself, `jq` throws away the
  shape of what came back, and one sitting put `| head -50` on an `answer`
  whose entire output is three lines.
- **One command per call, and never `answer && ask`.** Chaining those two
  printed every question twice — once as `answer`'s next prompt, once as `ask`
  re-asking the same open item — and on the last item of a batch it submitted
  and served the next one in the same breath, straight past the beat where the
  user says whether to carry on.
- **Never put the token value in a command.** It gets echoed into the visible
  tool call and from there into transcripts. Don't ask for it in chat either;
  the errors carry their own remedy — "No API token found" already says to
  copy `.env.example`, and a 403 already names the permission it needed.

## Reviews

Two commands, in a loop:

```
wanikani ask                              → prints the question
wanikani answer "<their whole reply>"     → prints the verdict and the next question
```

`ask` fetches a batch when there isn't one, re-asks the open item when there
is, and submits a finished batch before serving the next. `answer` grades
against whatever is open. **Neither takes an id, and there is no batch to
keep track of** — that all lives in a file on disk, which is also how a
sitting survives a new conversation walking into the middle of it.

So the whole loop is: `ask`, print it, wait. They reply, `answer` with what
they typed, print it, wait. When the output says the batch is done, `ask`
again — that submits it, prints the summary, and hands the turn back with
"Next batch whenever you're ready." Print that and wait; it is the asking
whether to continue, so don't write a second one under it (rule 3).

Every prompt names the kind of subject it is — `9. 末 (kanji)`, `3. 末
(vocabulary)` — because that glyph is two questions with two different
readings, and a sitting that met both of them fifteen minutes apart lost both.
The label is part of the question, so it goes on screen with the rest of it.

### The five rules

Everything the CLI can decide, it decides. These are what's left, and each
one is here because it has gone wrong in a real sitting.

1. **Their reply goes in verbatim — the whole line, exactly as typed.**
   Whatever separator they used, whichever order, typos and all. `page. pe-ji`
   went in as `page, peji`, which is a different word, and `.conventient. ben`
   went in as `convenient ben` — a typo silently corrected on the way past.
   The CLI knows what to do with the line; it does not need tidying, and an
   answer isn't yours to edit.

   The exception is a reply that isn't an answer at all. "tip 育" is a request
   for a hint, and it went into `answer` verbatim and cost the user the item.
   Anything with a kanji in it is a question — meanings are English and
   readings are kana — so send it to `explain` instead. `answer` refuses those
   now rather than grading them, but the refusal is a backstop, not the rule.

2. **Never type an answer.** Not a guess, not a hint, not "I think this one
   is". One sitting typed its own answer under four prompts in a row, and on
   one item the user answered `bear.` — correctly — while the session passed
   its own `wave` to the grader and recorded a miss on an item they had
   right. Recognising an item is not permission to fill it in. **If they have
   typed a reply, that reply is the only thing that goes into `answer`.**

   **And a pause is not a reply.** A later sitting answered two of its own
   prompts with nothing typed under either — 学歴 came back right, and 好 went
   in as "like. suki" against a こう that was the user's to get wrong. The gap
   before that second one was a session left open overnight. Waiting is the
   job: an unanswered prompt stays unanswered however long it sits there, and
   the turn doesn't come back round until they type.

3. **Add nothing to what the CLI printed, and take nothing out of it.** The
   verdict, the correction, the next prompt, the summary — all finished text.
   Don't rewrite it, don't shorten it, don't gloss the kana. Every compression so
   far has lost the same two things: `✗ (rib cage)`, `✗ (meaning: release,
   reading: hou)` and `✗ meaning/reading wrong` dropped the lookup link and
   put the reading back into romaji, and the last of those named neither half.
   The kana is the answer; the romaji is noise. That holds for anything you
   write in your own words too — the only romaji in a session is what the
   *user* types.

   **Past the first few lines, "already on the screen" stops being true.**
   Claude Code shows the head of a command's output and folds the rest behind
   "ctrl+o to expand", so a ten-item `grade-many` reaches the screen as three
   verdicts and a `+7 lines`. The seven in the fold are the corrections — the
   part of a review worth having. Nobody should have to expand a fold to find
   out what they got wrong, and nobody should have to *notice* there is one.
   So: **anything longer than about three lines, copy into your reply, whole
   and in order** — every line `grade-many` printed, characters, ✓/✗,
   corrections and links intact. Copying is not the restating this rule
   forbids; the ban is on writing your own version, and copying is how
   everything stays visible without one. One sitting wrote `4/10, items 1, 2,
   3, 7, 9, 10 wrong` under a folded batch instead: six misses named, not one
   of the six answers, and 転がる, 咅, 消 and 息 went past unseen. A one-item
   `answer` is two or three lines and needs none of this.

   **Nothing about an item that hasn't been asked yet, either.** One sitting
   wrote `3-17: day after tomorrow, battle, good, help, need, etc.` under a
   verdict — a look down the rest of the batch, in English, which is to say
   the answers. The next question was 明後日 and the user answered "day after
   tomorrow". What is on screen and when is `ask`'s to decide.

   **The batch summary is finished text like the rest of it.** One sitting
   echoed a summary line with `匚 slipped to Apprentice 4` quietly dropped out
   of the middle, and closed on "All reviews cleared from earlier batches.
   Session done. 47 total (77% perfect)" — a percentage nobody asked for,
   printed directly under a line that said 31 left. If a number looks wrong,
   `summary` and `status` will say; arithmetic in prose is how every miscount
   in this file started.

   **And the batch ends where the CLI stops printing.** Under the summary it
   adds "Next batch whenever you're ready." while reviews remain, and that is
   the last word — the turn is handed back, so ending the message *is* the
   question. A sitting that predates the line wrote its own at all eight
   batches, in eight spellings — "Continue?", "Stop?", "Stop wanikani?",
   "Final batch?", "Done for today?" — four of them offering to quit to
   someone who had typed "continue" or "next" every single time. The same
   sitting signed off with "147 items, 90 perfect (61% accuracy). Nice work!":
   a division nobody printed, under a line that had already said both numbers,
   and `perfect` is not accuracy — it counts items that went in clean on both
   halves, which is not what WaniKani means by the word. No percentage, no
   tally, no sign-off, no question of your own.

4. **A glyph-less radical's prompt is an image URL. Print the URL**, whole and
   clickable, with the `(radical)` the CLI puts after it. `7. Rib Cage image`
   names the radical, which is the answer; `5. Radical` doesn't name it but
   doesn't show it either, and the user answered a picture they never saw. The
   difference is the URL: describing the image replaces it, and the label sits
   beside it.

5. **A miss ends the item.** The correction contains the answer, so there is
   no retry to offer — the miss is already recorded and WaniKani doesn't offer
   one either. `Retry?` went out after nearly every wrong answer of one
   sitting; each one invited the user to read the answer back off the screen.

If a line starts with `!`, it's a problem to read rather than a verdict —
`NOT RECORDED` in particular means nothing was written down, and continuing
past it wastes the batch.

### Overruling a verdict

When the answer key says wrong and a reasonable reading of a typo says right:

```
wanikani answer --forgive meaning     (or --forgive reading)
```

It takes the last verdict back off the record — no id, and it works right up
until `ask` submits the batch. Say so in a short clause ("counting that as a
typo") and carry on. Forgiving out loud without this call still costs them
the level.

**`grade` says when an answer was close**, on a line of its own under the
correction, naming what it was close to:

```
(close to "Alcohol" — a typo on that word is `answer --forgive meaning`; a different word isn't)
```

That line is the one place your judgment is worth more than the table's, and
it is a comparison, not a cue. Put the two words side by side: a slip on the
named one — `alcholol` for Alcohol — is a typo and should be forgiven; a
different word that happens to be spelt alike is not, however near the flag
says it landed. `to transfer` on 伝える was flagged (three edits from "To
Transmit") and forgiven as a typo, and it isn't one — that hands over a level
WaniKani wouldn't have given, which is the one way this tool can put someone's
record out of step with the site it submits to. The line only ever *offers*;
the miss stays on the record until you make that call. It exists because
`--forgive` went unused for six sittings while it lived in this file, past
several plain typos, the same way the lookup link went unprinted for weeks.

### What they can ask for mid-batch

- **"more", "why", "mnemonic", a bare "?"** → `wanikani explain`, then `ask` to
  put the open question back — but only if a question *was* open. Between
  batches, under a summary and before they've said to carry on, there is
  nothing to put back and `ask` fetches ten new items instead: one sitting was
  asked to `explain 便 免 取れる`, printed the three blocks, and served a batch
  nobody had asked for underneath them. A question about an item is a detour,
  never a yes. **Run it — never answer from memory.** "No
  mnemonic on file" and a recollected paragraph in place of `explain 親` are
  both from real sittings, and both were wrong. Never run it unasked.

  **The block is the answer — print it.** Running the command and then
  summarising it in your own words is the same failure with an extra step,
  because what gets added is what WaniKani didn't say. Asked the difference
  between 場 and 所, one sitting ran both, printed neither, and wrote
  "場所 = only physical location" underneath — a usage rule from nowhere, and
  wrong, and the user had to correct it. `explain` carries meanings, readings,
  parts and mnemonics; it does not carry how two words differ in use, so
  neither do you. Two items compared is two blocks, and anything you write
  between them has to be a sentence you could point at in one of them.

  Bare, with nothing after it, is the item that's *open* — the one `ask` just
  printed. That's what they mean while a question is on screen, and it saves
  copying the character across. **Asked straight after a verdict, they mean the
  item that just graded instead** — name it, `explain 放`, off the correction
  line. Bare there would explain the next item and hand over its answer.
- **Any other question about an item** — "what was that one again?", "how does
  this relate to X?" — goes through `explain` too, for the same reason, and
  ends the same way: the block, printed. If what they asked isn't in it, say
  that rather than filling the gap.
- **"what can I say?", "help"** → `wanikani tips`. Don't hand-roll
  tips and don't volunteer them; if it isn't in `tips` it belongs in
  `lib/tips.js`, which is a code change and not something to improvise
  between two items.
- **"did that go through?", "what's left?"** → `wanikani status`.
  It reads the local record — no token, no network — so it answers when
  nothing else does. **Don't theorise about the tool; ask it.** "CLI broken"
  and "use the WaniKani web interface instead" both went to a user in one
  sitting, over a problem that was one `status` call away from being visible.
- **"wait", "hold on", "one at a time"** → stop auto-advancing and wait for
  them between items, for the rest of the sitting.
- **"stop", "that's enough for now"** → `wanikani submit-batch` sends what
  they've answered so far and leaves the rest due. Say what it reports and
  stop. **A part-answered batch is not a batch that can't be submitted** — one
  sitting was told "can't submit partial" and left ten answers to expire with
  the sitting. Answers only go nowhere if nobody sends them.
- **A whole batch in one message** ("rapid fire") → `ask --all` for the whole
  open list, `grade-many "<a> | <b> | ..."` for their reply, then `ask --all`
  again to submit and, once they've said to carry on, serve the next list.
  Two commands in a loop, the same as the one-at-a-time flow. `--all` is the
  only difference: plain `ask` prints the *first* open question, so the way
  this used to be written was `ask` and then `prompts`, which printed question
  one twice and cost a call on every batch — one sitting paid it eight times.
  Nothing needs `prompts` any more either: `grade-many` re-asks whatever its
  round left open, under the verdicts.

  **If `grade-many` says the answers don't line up, print the whole refusal
  and wait.** A list that skips an item in the middle without leaving a gap
  grades every answer after it against the question before its own; that went
  unnoticed through a whole batch once and cost three SRS levels on items the
  user had right. It records nothing, names the item that looks skipped, and
  re-prints the batch underneath — so what goes on screen is that block, whole,
  and what comes next is their list again. Don't re-align their answers
  yourself and don't send a fixed-up version (rule 1); the answers are theirs,
  and a full-length list is graded exactly as typed. Same rules — and
  this is the path where the fold in rule 3 bites, both ways: the list of
  questions and the list of verdicts are ten lines each, and both get copied
  out of the tool output into the reply, in full. Offer it once, between batches, if they're
  moving fast — and **if they ask for it, run those commands.** One sitting
  opened on "batch rapid fire", made up a convention of its own to print at
  them (`answer "a1 | a2 | a3"`), never called the list or `grade-many`, and
  took all forty-seven items one at a time.
- **"drill me on what I got wrong"** → `wanikani drill`, then
  `grade` per item. Nothing there is due and nothing submits; say that once.
- **"critical items", "what am I worst at?"** → `wanikani critical-condition`
  (`critical` is the same command, shorter), then
  `grade` per item, same as a drill — nothing there is due and nothing
  submits. It's the list wanikani.com/critical-items shows, fetched from the
  same records: every item WaniKani has under 75% correct, worst first. That
  makes it the wider net of the two — `drill` only knows the misses this tool
  watched happen, so on a fresh install it's empty and it never includes
  anything reviewed on the website. Ten by default; the payload says how many
  more there are and `--limit N` fetches them. `--under N` moves the line if
  they ask for a tighter one.
- **"update wanikani", "pull the latest"** → `wanikani update`. It pulls the
  repo it lives in, so it works from any directory and needs no path from
  anyone — don't go looking for the checkout or ask where it is. Print what it
  says: it ends by naming whether the change is live already or wants a Claude
  Code restart, and that's the only part they have to act on.

## Lessons aren't part of this

This tool does reviews. There is no `lessons` command and no `start` command —
they were removed rather than left half-finished, because the teaching flow
was never once used and an untested path that writes to someone's account is
worse than no path at all.

Asked to do lessons, say they're done on wanikani.com and offer reviews
instead. **Don't improvise a lesson.** Teaching from `explain` output, or from
what you know about an item, is the same thing that has gone wrong every other
time this skill has filled a gap with prose — and here it would also leave the
items unstarted, so nothing taught would enter the SRS and the work would be
invisible to WaniKani.

## Account check

`wanikani summary [--json]` — level, reviews available, time to the next
batch. It reports a lesson count too, and says where lessons get done. That's
the account; `status` is the sitting's own record.

---

Every rule above is the residue of a sitting that went wrong. The full
account of what happened and what it cost is in `FAILURES.md` beside this
file — read it before changing any of this, not during a session.
