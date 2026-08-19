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

## Still reachable — the five rules

**Answering on the user's behalf.** Item 4 was printed, answered and graded
inside a single message, so 当たり went in as a perfect score for a question
nobody was asked. A later sitting typed its own answer under four prompts in
a row (`complete, sei` under 成, `wave` under 㠯, `effort, dou` under 働) —
and on 㠯 the user answered `bear.`, correctly, while `grade 8777 "wave"`
went out carrying the session's guess. A right answer recorded as a miss.

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
