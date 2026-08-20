---
name: wanikani
description: Run a WaniKani lesson or review session from Claude Code, using the wanikani CLI in this repo to talk to the WaniKani API. Trigger on "/wanikani", "do my wanikani reviews", "wanikani lessons", or similar requests to study kanji via WaniKani.
---

# WaniKani study session

Invoked with nothing more specific ("/wanikani", "do my wanikani reviews"),
go straight into Reviews below. Don't offer a menu; branch to Lessons or the
account check only if their own wording asked for one. If plan mode is
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
- **No `2>/dev/null`, no `| jq`.** stderr is where a refusal explains itself,
  and `jq` throws away the shape of what came back.
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
again — that submits it and prints the summary. Then ask whether to continue.

### The five rules

Everything the CLI can decide, it decides. These are what's left, and each
one is here because it has gone wrong in a real sitting.

1. **Their reply goes in verbatim — the whole line, exactly as typed.**
   Whatever separator they used, whichever order, typos and all. `page. pe-ji`
   went in as `page, peji`, which is a different word, and `.conventient. ben`
   went in as `convenient ben` — a typo silently corrected on the way past.
   The CLI knows what to do with the line; it does not need tidying, and an
   answer isn't yours to edit.

2. **Never type an answer.** Not a guess, not a hint, not "I think this one
   is". One sitting typed its own answer under four prompts in a row, and on
   one item the user answered `bear.` — correctly — while the session passed
   its own `wave` to the grader and recorded a miss on an item they had
   right. Recognising an item is not permission to fill it in. **If they have
   typed a reply, that reply is the only thing that goes into `answer`.**

3. **Add nothing to what the CLI printed.** The verdict, the correction, the
   next prompt, the summary — all finished text, on the screen already. Don't
   restate it, don't shorten it, don't gloss the kana. Every compression so
   far has lost the same two things: `✗ (rib cage)` and `✗ (meaning: release,
   reading: hou)` dropped the lookup link and put the reading back into
   romaji. The kana is the answer; the romaji is noise. That holds for
   anything you write in your own words too — the only romaji in a session is
   what the *user* types.

4. **A glyph-less radical's prompt is an image URL. Print the URL**, whole and
   clickable. `7. Rib Cage image` names the radical, which is the answer;
   `5. Radical` doesn't name it but doesn't show it either, and the user
   answered a picture they never saw.

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
correction:

```
(close — `answer --forgive meaning` if that was a typo)
```

That line is the one place your judgment is worth more than the table's.
Read what they actually typed: a slip on the right word — `alcholol` for
Alcohol — is a typo and should be forgiven, and a different word that happens
to be spelt alike is not. The line only ever *offers*; the miss stays on the
record until you make that call. It exists because `--forgive` went unused for
six sittings while it lived in this file, past several plain typos, the same
way the lookup link went unprinted for weeks.

### What they can ask for mid-batch

- **"more", "why", "mnemonic", a bare "?"** → `wanikani explain
  <id|characters>`, then `ask` to put the open question back. **Run it — never
  answer from memory.** "No mnemonic on file" and a recollected paragraph in
  place of `explain 親` are both from real sittings, and both were wrong. The
  user typing the command themselves (`explain 転送`) is not an exception. It
  means the item just *graded*, not the one now open — that one would be
  handing over the answer. Never run it unasked.
- **Any other question about an item** — "what was that one again?", "how does
  this relate to X?" — goes through `explain` too, for the same reason.
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
- **A whole batch in one message** ("rapid fire") → `prompts` lists what's
  still open as one block, `grade-many "<a> | <b> | ...>"` grades them in that
  order. Same rules; the CLI still prints everything. Offer it once, between
  batches, if they're moving fast.
- **"drill me on what I got wrong"** → `wanikani drill`, then
  `grade` per item. Nothing there is due and nothing submits; say that once.
- **"update wanikani", "pull the latest"** → `wanikani update`. It pulls the
  repo it lives in, so it works from any directory and needs no path from
  anyone — don't go looking for the checkout or ask where it is. Print what it
  says: it ends by naming whether the change is live already or wants a Claude
  Code restart, and that's the only part they have to act on.

## Lessons

Teaching, not quizzing — so unlike reviews, everything is meant to be said
out loud: the characters, the meaning, the reading, the mnemonic.

1. `wanikani lessons --json --limit 5`. Batches of ~5; lessons are
   heavier going than reviews. They arrive in WaniKani's teaching order —
   radicals before the kanji built from them — so take them as given. Empty
   array: say there's nothing to learn and stop.
2. One item per message: characters, meaning, reading (kana only), and the
   mnemonic in your own words rather than read out. Tie it to a radical or
   kanji they've already had where the mnemonic does. Then ask if they've got
   it and wait — the question is the last thing in the message.
3. When the batch is done, mark them all started in one call:
   `wanikani start 551149968 603114625`. Report anything that
   failed rather than assuming it went through; a 403 means the token is
   missing `assignments:start`. (Don't run `lessons --start` — it prompts per
   item and needs a real terminal.)
4. Starting is what puts an item into the SRS: Apprentice 1, first review a
   few hours later. Mention that once at the end — "5 started, first reviews
   in 4h" — not per item. Anything they'd rather skip just doesn't go in the
   `start` call.

## Account check

`wanikani summary [--json]` — level, lessons available, reviews
available, time to the next batch. That's the account; `status` is the
sitting's own record.

---

Every rule above is the residue of a sitting that went wrong. The full
account of what happened and what it cost is in `FAILURES.md` beside this
file — read it before changing any of this, not during a session.
