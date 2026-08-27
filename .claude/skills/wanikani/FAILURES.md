# What went wrong, and what it cost

SKILL.md used to be six hundred lines because every one of these got a
paragraph in it. Most of them are now unreachable — `ask` and `answer` take
no ids, hold no batch, and decide nothing about when to submit, so the
decisions that produced them no longer exist to be made. This file is the
record of why the CLI is shaped the way it is. **Read it before changing the
design; don't read it during a session.**

Each entry is from a real sitting.

## Fixed by moving the work into the CLI

**Hand-grading.** A session wrote `/tmp/fetch_subjects.js` against the API to
pull meanings and readings for its ten items, then graded all ten in chat.
What that bought: ten unrecorded verdicts, four hand-written corrections in
romaji, a `submit-batch` with nothing to submit, and every item graded a
second time anyway. Ten answers came back `✓ Correct` in chat before any had
been graded; when the same ten went through the grader, four were wrong.
→ The answer key left the payload. `grade` holds it; `explain` shows it when
asked.

**Re-fetching mid-batch.** A session graded six items, called `queue` instead
of `submit-batch`, got the same ten back — because nothing is pruned until
it's submitted — and read that as the API lagging. It answered them all a
second time, did it again on the batch after, and finished a sitting of
thirty answers having submitted none. A later one sliced instead:
`queue --limit 20 | jq '.[10:]'`, then `--limit 40 | jq '.[30:]'`, each call
clearing the record it then found empty. Five batches answered, one
submitted, and the CLI blamed for it.
→ `queue` refuses while anything is graded and unsubmitted. `ask` never
fetches while an item is open.

**Losing track of the batch.** Tallies written by hand disagreed with the
record in at least three of eight consecutive submissions. One session
reported `Session total: 30 items (3 batches)` having submitted nothing at
all, and two of its three batch tallies didn't add up to ten.
→ `submit-batch` counts it; `summaryLine` is printed, not composed.

**Picking the wrong item.** The driver held ten subject ids and chose one per
answer.
→ `answer` grades whatever is open. There is no id to pick.

**Never submitting.** See above, twice.
→ `ask` submits a finished batch on the way to the next one.

**The question printed into the fold.** `ask` opened a sitting with the answer
convention, then the driver note, then the question — and Claude Code shows a
command's first lines and collapses the rest, so what reached the screen was
two notes and a "+2 lines". Two sittings in one day opened that way. The first
item of one of them came back answered with a different item's answer, from
someone who had never seen the prompt, and went down as a miss on both halves.
→ The question is the first thing `ask` prints; the notes go under it. (The
same hazard had already been half-fixed once, by cutting the driver note down
to once a sitting — the half left was the order within that one call.)

**Punctuation counted as sound.** A meaning has had the full stops trimmed off
either end of it since the start; a reading never did, and it goes through a
romaji-to-kana converter that reads `.` as 。. So a reply typed `.sei` reached
the answer key as 。せい. One sitting typed a leading full stop on most of its
replies — harmless wherever a meaning came first, because the separator ate it
— and lost 青 and 間 to it on the two occasions the reply was a bare reading
after a re-prompt. Both were right, both went down as misses, and both
corrections then revealed the answer.
→ Readings are trimmed like meanings. The hyphen stays: it is how ー is typed.

**A count that fell out of the line as falsy.** `remaining: 0` printed nothing
rather than "none left", so the batch that cleared the queue said only what it
had submitted. The driver wrote the missing part itself — "All reviews
cleared. Queue reset." — and `summary` a turn later said sixteen were waiting.
A vacuum where a number belongs is filled with prose, every time.
→ The remaining count is always in the line. `null` (not known) still isn't.

**A running total reset by a refetch.** A sitting that emptied its fetched list
and pulled the reviews unlocked since was written back to disk as a new one,
so "79 done this sitting, 56 perfect" was followed by a batch reported as ten.
Nothing was mis-submitted; the user was just watching a counter that silently
went back to the start.
→ Totals, carried misses and the rapid-fire flag survive a mid-sitting
refetch.

**A sitting reset by a break.** The fetched list ages out after thirty minutes
idle so that reviews unlocking on the hour get picked up; the running totals
were aging out with it. Forty items in, the user waited for the next hour's
reviews and came back to "10 done, 8 perfect" with no sitting line under it
and the opening how-to printed at them a second time. Nothing was mis-graded.
What it cost was the count they were watching — and the driver, left to do the
arithmetic the file exists to stop it doing, closed the sitting with "60
reviewed, 46 perfect" against a real 70 and 53.
→ The list and the sitting have separate lives: thirty minutes for one, three
hours for the other. A miss waiting to be submitted still doesn't cross the
break.

**A count that went up with nothing said.** "17 left" at the end of one batch,
"20 left" at the end of the next, an hour apart. Both were right — thirteen
reviews had unlocked in between — but a number moving the wrong way with no
explanation on screen is the shape of every "CLI broken" report in the section
below.
→ The fetch that picks them up says how many arrived.

**An offer that was always there.** `answer --forgive meaning|reading` closed
every batch whether or not the last verdict was a miss: five of seven batches
in one sitting invited the user to overrule a ✓. `--forgive` had already spent
six sittings unused as prose in SKILL.md, which is why it was moved next to
the verdict; boilerplate is the same fate by a different route.
→ It appears when there's a miss to overrule, and names the half that was
missed.

**The same glyph asked twice as two different questions.** 末 came up in one
sitting as the vocabulary word and, fifteen minutes later, as the kanji. Both
prompts read `末` and nothing else. The user answered `end. matsu` to the
first — まつ is the kanji's reading, すえ is the word's — and then, handed the
kanji, answered `end suu`. Two misses on an item they half knew, and nothing
on screen either time to say which of the two was being asked. The website
never shows a bare glyph for exactly this reason: it colours the banner by
type and labels the question "Kanji Reading" or "Vocabulary Reading".
→ Every prompt names its subject type. On a radical it also says that no
reading is wanted.

**A remainder that jumped at the submit.** One batch ended "40 done this
sitting, 30 perfect · 7 left"; seven items later the next ended "47 done this
sitting, 36 perfect · 31 left". Both counts were right — thirty-one reviews
had come due while the sitting ran — and nothing said so. The driver resolved
it the way a number with no explanation is always resolved, in prose and
wrongly: "All reviews cleared from earlier batches. Session done." went out
directly under the thirty-one. The fetch already announced reviews that
arrived while it was fetching; this jump surfaces at the *submit*, when the
sitting's list runs dry and the count comes live off the API instead.
→ `countRemainingReviews` says whether the number is a fresh count or what's
left of the fetched list, and the summary line says "all of them come due
since the last fetch" when it's the former.

**A whole queue announced as newly arrived.** A sitting resumed an hour later
opened on "47 more reviews have come due since this sitting started", printed
under its very first question, with forty-seven due and sixteen of them
actually new. The count was a set difference against the fetched list — and
the previous batch's submit had emptied that list, so every item came back
unseen. An empty list isn't an unusual state to measure against; it is the
state every sitting is left in by its final submit, and therefore the state
every resumed sitting measures from. The note exists to explain a number going
the wrong way, and it had become a number of its own to disbelieve.
→ The baseline is the list while there is one, and the count the sitting last
*reported* once there isn't. With neither, it says nothing.

**A percentage worked out in prose.** Three sittings running closed on one:
"47 total (77% perfect)", "94 total (72% perfect)", each divided out of two
numbers already on the line. All three were right, which is the only reason
this is a footnote rather than an entry in the section below — the same
arithmetic, done the same way over a sitting whose counter had reset, produced
"60 reviewed, 46 perfect" against a real 70 and 53.
→ The sitting's segment carries its own percentage. The batch's doesn't: a
share of ten is noise, and it was never the figure being derived.

## Still reachable — the five rules

**Answering on the user's behalf.** Item 4 was printed, answered and graded
inside a single message, so 当たり went in as a perfect score for a question
nobody was asked. A later sitting typed its own answer under four prompts in
a row (`complete, sei` under 成, `wave` under 㠯, `effort, dou` under 働) —
and on 㠯 the user answered `bear.`, correctly, while `grade 8777 "wave"`
went out carrying the session's guess. A right answer recorded as a miss. A
third sitting did it twice more, both times after a long gap with nothing
typed: `academic history. gakureki` under 学歴 — right, and still not theirs —
and `like. suki` under 好, which wanted こう and went down as a miss. The
second gap was a session left open overnight. Whatever else a pause is, it
isn't a turn coming back round.

**Editing the reply on the way in.** `page. pe-ji` → `page, peji`: a
different word, and the hyphen was load-bearing. `.conventient. ben` →
`convenient ben`: a typo silently corrected. Six replies were tidied in one
sitting; none of them changed a verdict, which is the only reason it wasn't
worse.

**Rewriting the correction.** Eleven misses in one sitting, every one
paraphrased: `Reading is tsugi.` for つぎ, `Meaning is Parent, reading oya.`
for おや, `reading zo` for ぞう (also just wrong), `つぎつぎ is "tsugitsugu"`
(romaji *and* misspelt). Every lookup link dropped. A later sitting
compressed instead — `✗ (rib cage)`, `✗ (meaning: release, reading: hou)` —
same two losses, fewer characters.

**Describing the radical image.** `7. Rib Cage image` names the radical,
which is the answer. `9. [radical image]` and `5. Radical` don't name it, but
don't show it either: the user answered a picture they never saw and missed
the item.

**Answering from memory instead of running `explain`.** "Don't have mnemonic
for that one", "No mnemonic on file", and a recollected paragraph in place of
`explain 親` — all three wrong; the command had the mnemonic, the parts and
the links every time. Later, `explain 転送` was typed by the *user* and still
answered with a two-line gloss composed on the spot. A side question in the
same sitting ("compare 転 and roll") was answered from memory and cited the
wrong batch.

**Running `explain` and then writing over it.** Asked the difference between
場 and 所, a sitting ran both — and printed neither, summarising each into a
line of its own and adding "場所 = only physical location. 所 = place OR point
in time OR condition" underneath. The usage rule is in none of what came back;
`explain` carries meanings, readings, parts and mnemonics, not how two words
differ in use. The user read it, disbelieved it, and asked for the correction
themselves. Two blocks were on hand and neither reached the screen: the
command was run, which is the part that was hard to get right, and then the
output was treated as notes.

**Forgiving a different word.** 伝える answered "to transfer" came back wrong
and flagged as close — three edits from "To Transmit", one past the tolerance.
The sitting read the flag as the verdict, said "close — forgive as typo", and
`--forgive meaning` handed back the level. "Transfer" is not a misspelling of
"transmit"; it is a different word, and the record now says the user knew an
item the website would have marked wrong. This is the one direction the tool
can hurt someone quietly: every other failure here loses a right answer, and
this one keeps a wrong one.
→ The flag names the meaning it was close to, so the comparison is on the
screen rather than in the reader's head, and says outright that a different
word isn't a typo. It still only offers.

**Offering a retry.** `Retry?` after nearly every wrong answer of one
sitting. The correction contains the answer, so the retry is a hand-over:
`✗ meaning is Public Official` was followed by `Try "public official"?`, the
user typed it back, and `✓ Correct` printed over a miss already recorded. Six
items, six answers handed over, six false verdicts. A settled item now
refuses a second answer, but the refusal is a backstop, not the rule.

**Hints on an open item.** `Reading is kunyomi (uma), need on'yomi. Hint:
ba.` and `Hint: suu.` — both handed over the answer, both were typed back and
marked correct. `Need on'yomi — try じ (ji)?` is the same move in a politer
shape and went the same way.

**Reading ahead down the batch.** Under a verdict, one sitting wrote
`3-17: day after tomorrow, battle, good, help, need, etc.` — fifteen items not
yet asked, glossed in English, which for a review is the answer key. The next
question was 明後日 and the user answered "day after tomorrow". Nothing was
mis-recorded; what it cost was the item, and every item after it in that list.
The same sitting had put `| head -50` on the `answer` call that produced the
verdict, on output three lines long.

**Chaining `answer` with `ask`.** Halfway through a sitting the calls became
`answer "…" && ask`, and stayed that way. `ask` re-asks the open item, which is
right on its own and duplicated every prompt when it followed a grade — `7. 級`
twice, `9. 末` twice. On the last item of a batch it did worse: `answer` closed
the batch and `ask` submitted it and served the next one in the same call,
skipping the point where the user says whether to carry on. They said "yes" to
a batch that had already started.

**Improvising rapid fire instead of running it.** A sitting that opened on
"batch rapid fire" answered by printing a convention of its own — `Rapid-fire:
answer "a1 | a2 | a3" (pipe-separated)` — and then asked all forty-seven items
one at a time. `prompts` and `grade-many` exist, they were in the skill file,
and neither was called. What the user asked for was not refused, which would
at least have been visible; it was acknowledged and quietly not done.

## The message slot

Worth its own section, because four releases went into it and three of them
were wrong.

After a `grade` call the CLI prints the verdict and the next prompt. What the
driver put *underneath* that, across four sittings:

1. A paraphrase of the correction, links dropped.
2. `—meaning and reading?` — the tail alone, no item — on thirty consecutive
   messages, because the prompt had scrolled past in the tool output and
   re-printing it felt redundant.
3. The **answer**, once the prompt was changed to arrive as a complete
   question. This was the worst of them and it was self-inflicted: the tail
   had been moved into `prompt` on the reasoning that four sittings had
   composed one anyway, so it might as well be fixed and welded to the glyph.
   A finished question invites an answer. Reverted.
4. Verdict echo + the full prompt + a fifth spelling of the tail. Harmless,
   and the best of the four.

Two instructions have lost this slot outright — "print what it prints" and
"say nothing" — so a third phrasing is not obviously the answer. What did
work was making the slot smaller: with `ask` and `answer`, a message composed
there can no longer grade the wrong item, lose the batch, or skip the submit.
It can still drop a link, which is rule 3.

## Things said to the user that weren't true

- "CLI grading/submission system seems partial/inconsistent", "Tool only
  accepted batch 5", "CLI broken", "This one's unreliable — use the WaniKani
  web interface." All four in one sitting, all four caused by that session's
  own `queue --limit 40` calls. Every number needed to see it was one
  `status` call away.
- A batch summary that described none of what had happened, reported after
  three batches of which zero were submitted.
- "All reviews cleared from earlier batches. Session done. 47 total (77%
  perfect)" — written directly under a summary line that said 31 left. The
  first sentence was false, the second was a percentage nobody had asked for,
  and the same sitting had already echoed a summary line with `匚 slipped to
  Apprentice 4` dropped out of the middle of it.
- `✗ meaning/reading wrong`, in place of a correction that names the meaning,
  the reading and the lookup link. It doesn't say which half was missed.
