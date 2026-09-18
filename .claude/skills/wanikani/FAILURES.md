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

**The batch results printed into the fold.** Same hazard as the question
above, at the other end of a batch. `submit-batch` printed its whole payload
— a hundred and fifty lines for a batch of ten — so what reached the screen
was `{`, `"summaryLine": …`, `"results": [`, and the sentence written for the
user was something to go digging for behind "ctrl+o to expand". The user's
own words: "I want to be able to always see the results from batch runs, the
ctrl+o doesn't always catch it right, and I shouldn't have to type that
anyways."
→ `submit-batch` prints the line and nothing else. `--json` still gives the
payload, for debugging this CLI.

**The fold summarised instead of printed.** `grade-many` prints one verdict
per item, which for a batch of ten is three verdicts on screen and seven
behind a `+7 lines`. A sitting wrote `4/10, items 1, 2, 3, 7, 9, 10 wrong`
underneath — six misses named and not one of their answers, while the
corrections for 転がる, 咅, 消 and 息 sat unread in the fold. The tally was
right; it was also the entire review, minus the review.
→ Rule 3: output longer than a few lines gets copied into the reply, whole.
This one is not fixable in the CLI — the corrections are as short as they can
be and there are still ten of them — so it is the rare case where repeating
the tool's output is the instruction rather than the failure.

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

**The sign-off nobody printed.** Eight consecutive batches of one sitting
ended with the summary line and then a question the driver wrote itself, in
eight spellings: "Continue?", "Next?", "Done?", "Stop?", "Stop wanikani?",
"Final batch?", "Done for today?", "Done for today?" — four of them offering
to quit to a user who typed "continue", "next" or "yes" every single time.
The same sitting closed on "Session done: 147 items, 90 perfect (61%
accuracy). 62 left. 5 moved up, 1 burned. Nice work!" The percentage is
arithmetic on a line that had already printed both numbers, and it isn't even
the right word: `perfect` counts items that went in clean on both halves,
which is not what WaniKani calls accuracy. It is the same slot that produced
"47 total (77% perfect)" (below, under things said that weren't true): the
beat where a batch ends and the turn goes back is where prose gets invented,
every time, because a summary reads as an ending that wants a sentence after
it.
→ `ask` prints "Next batch whenever you're ready." under the summary while
reviews remain, so the sentence exists and is the same one each time. Nothing
goes after it.

**Two calls to ask one list.** The rapid-fire path was written as `ask` for
the batch and then `prompts` for what's open, because `ask` prints only the
first question. So every batch cost a round trip whose entire output was
question one printed a second time — eight of them in one sitting. The same
shape at the other end: `grade-many` ended on "Still open: 2 — still their
turn (`prompts` re-asks what's left)", and three times in that sitting the
driver ran `prompts` to learn what item 2 was, which the call that printed
the line already knew.
→ `ask --all` prints the whole open list, and `grade-many` prints its own
leftovers underneath the verdicts. A rapid batch is two calls, the same as the
one-at-a-time loop. (The once-a-sitting how-to stays off the leftover list:
spending it on the two items left over from a round is how the next opening
list ends up without it.)

**`explain` read as a yes.** Asked to `explain 便 免 取れる` at the beat after
a summary — before saying whether to carry on — the driver printed the three
blocks and then called `ask`, which had no open question to put back and so
fetched ten new items. The skill said "then `ask` to put the open question
back" — true mid-batch, and between batches the same call is ten new items.
→ SKILL.md says it: a question about an item is a detour, never a yes, and
`ask` after `explain` only when something was open.

**A batch graded one question out of step.** Ten items, nine answers. The
fourth item was a radical the user didn't know, and they left it out of the
list rather than blanking it — so answer four went against item four, and
every answer after it went against the question before its own:

| item | got | which answers |
| --- | --- | --- |
| 4. 𠫓 (Trash) | "used chuuko" | 5. 中古 |
| 5. 中古 | "sipmle" | 6. 単 |
| 6. 単 (Simple) | "to lack something kaku" | 7. 欠く |
| 7. 欠く | "to become naru" | 8. 成る |
| 8. 成る | "decision dettei" | 9. 決定 |
| 9. 決定 | "become sei" | 10. 成 |

Six misses on five items the user plainly knew; 中古, 決定 and 持つ went in as
demotions, two of them undeserved. Nothing on screen gave it away, because
every correction printed was a correct correction *for the item above it* —
中古's line really does say ちゅうこ. The tenth item fell off the end, was
re-asked on its own, and came back ✓ on the same answer that had just been
graded against 決定. `grade-many`'s existing guard covers the opposite case,
a reply with more parts than there are open items, and says in its own comment
that a misaligned batch "grades ten right answers as ten wrong ones against
the wrong items, and nobody would see it until submit". A *short* reply can't
be refused the same way: answering a few and keeping the rest is a documented
thing to do, and is indistinguishable from this by counting alone.
→ `lib/alignment.js` scores the reply against every in-order pairing it admits
before anything is recorded, and refuses when one fits by a whole item or more
better than position-for-position does. It asks for the batch again — naming
the item that looks skipped and re-printing the questions — rather than
re-pairing the answers itself: guessing at what somebody meant is not a thing
to do to a record that submits to WaniKani, and one retype is cheap. A
full-length list has nothing to shift and is always graded as typed, which is
also the way past a false alarm. And the how-to now says how to skip one in
the middle — an empty slot — which is the part that was missing: "answer as
few as you like" is about the end of the list and says nothing about a gap in
it.

The margin is a whole item, so the one shape it still lets through is a skip
whose only following answer is worth a single point (a radical, or kana
vocabulary). Deliberate: below a whole item the evidence is indistinguishable
from an answer that happens to sit near something else in the batch, and a
false refusal costs a retype of ten answers.

**A summary line edited on the way to the screen.** `4 done, 3 perfect · 内 →
Burned · 94 done this sitting, 62 perfect · 14 left — all of them come due
since the last fetch` was printed, and what reached the user was `4 done, 3
perfect · 内→Burned · 94 total, 62 perfect (66%) · 14 left`. Three edits: a
percentage added, "done this sitting" shortened to "total", and the clause
explaining why 14 is more than 4 dropped — which is the one thing on that line
that exists specifically to stop a number being resolved in prose. The same
sitting also wrote `Open: 10` in place of `Still open: 10 — still their turn`,
and closed on `Session: 94 done, 62 perfect (66%). Done!`
→ Nothing new. Rule 3 covers it, the carry-on line gives the sign-off
somewhere to stop, and this is the fourth transcript of the same habit; the
record is here so the next person changing rule 3 knows prose has not fixed it
three times.

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
