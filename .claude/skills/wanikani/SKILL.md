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

1. Run `node bin/wanikani.js queue --limit 10` and parse the JSON — `queue`
   always prints JSON, with no flag needed; it has no `--json` option (that
   flag only exists on `summary`), so don't pass one or it'll error out.
   Fetch in
   batches of ~10 rather than one at a time (there can be hundreds due; one
   `queue` call per item wastes a round-trip per review for no benefit, since
   you already have the next 9 answer keys in hand). Each item has
   `assignmentId`, `characters` (null for some radicals that have no
   Unicode glyph — see below), `needsReading`, `meanings`,
   `auxiliaryMeanings` (type `whitelist` = also acceptable, `blacklist` =
   looks plausible but is wrong), and `readings` (only the ones with
   `accepted_answer: true` are correct). When the batch is exhausted, run
   `queue --limit 10` again — items just submitted have moved out of the
   due queue, so this naturally returns the next batch, not repeats.

   For a `characters: null` item, render `characterImageUrl` as an inline
   image instead — `![radical](url)` — that's the actual glyph, the same
   thing WaniKani's own review screen shows. **Never** say the item's name
   or `meanings` value as the prompt itself (e.g. "Beggar?") and never show
   `documentUrl` in place of the image — both bake the answer into the
   prompt (the name is literally what's being tested, and the WaniKani page
   URL slug is the name, e.g. `.../radicals/beggar`). If `characterImageUrl`
   is ever null too (no image available), say so and skip grading that
   item's meaning rather than guessing at a prompt that might give it away.
2. If the queue is empty, tell the user there's nothing due right now and stop.
3. State the combined-answer convention once, at the start of the first
   batch only ("meaning and reading together in one line, e.g. 'fur, ke' —
   I'll grade both"). After that, prompt each item with just the item
   itself — "毛?" or "次: 表す" — don't repeat the "meaning and reading?"
   framing on every single item; it's redundant once the user knows the
   convention. A reply like "fur, ke" or "fur / ke" or even just "fur ke" on
   one line should grade both parts from that single message — don't make
   the user split it into two turns unless they want to. Parse whichever
   part looks like a reading (kana, or romaji per `readings`) as the reading
   and the rest as the meaning; order doesn't matter ("ke fur" works the same
   as "fur, ke"). If they only gave the meaning and got it right, grade that
   and ask "Reading?" as a quick follow-up — it's worth the extra turn since
   they clearly know the item. If the meaning was wrong, don't chase a
   reading separately: count it wrong too, reveal both in the correction,
   and move on — a missed meaning means asking for the reading in a follow-up
   turn is very unlikely to change the outcome, so it's not worth the
   round-trip. For meaning-only items (radicals,
   kana_vocabulary), the prompt is just the item itself too — no need to
   spell out "meaning?" each time either. Keep each prompt to the item
   alone — no numbering ("1.", "2."), no type label, no batch-position
   preamble. Write "毛?" — or, for a `characters: null` radical, just the
   rendered `characterImageUrl` image with no caption — not "1. Radical —
   Beggar. Meaning?" or "Batch 1 of ~52, item 1: 毛". This rule about type
   labels isn't just about tidiness: **never put the item's own meaning
   name anywhere in the prompt**, in any form — not "ユ (Hook radical)?",
   not "ユ — Hook?", nothing. For a radical the meaning name *is* the
   answer, so a "helpful" label that names it defeats the quiz as badly as
   answering it yourself. The prompt is the character (or image) alone,
   full stop, whether or not `characters` is null.
4. Judge both parts against the item's own data, not exact string matching:
   meaning against `meanings`/`auxiliaryMeanings` (accept reasonable synonyms
   and minor typos; reject anything matching a `blacklist` entry even if it
   seems plausible), reading against `readings` (accept kana or romaji). Keep
   a running count of wrong attempts per item, per part.
5. When correcting a wrong reading, give the kana only — never add a romaji
   gloss in parentheses after it, in any form. Write "correct is かい, not
   さん" — not "correct is かい (kai), not さん (san)" and not "it's あたり
   (atari), not mawari (that's 回り, different word)". This applies to every
   reading mention: corrections, onyomi/kunyomi call-outs, anywhere. If you
   notice romaji creeping into a correction, drop it before sending.

   When an item is wrong (either part), also drop a Jisho link for it
   alongside the correction so the user can dig in right away:
   `https://jisho.org/word/<characters>` (raw characters in the URL is fine —
   e.g. `https://jisho.org/word/味` — browsers percent-encode it as needed).
   Skip this for radicals with a null `characters` — link `documentUrl`
   instead, since radicals aren't real words Jisho would know.
6. **Auto-advance within a batch**: whether an item was right or wrong, say
   so briefly and move straight into the next item's prompt in the same
   message — don't wait for the user to say "next" or "continue" between
   items. Only pause the advance if the user explicitly asks to slow down,
   review an answer, or stop (e.g. "wait", "hold on", "explain that one") —
   treat that as a standing preference for the rest of the session once
   they've said it, not a one-off. This only applies *within* a batch —
   between batches, see step 8.
7. Track each item's `wrongMeaning`/`wrongReading` counts in your own head as
   you go — don't shell out per item. Once the whole local batch (all ~10)
   has been quizzed, submit it in **one** bash call via `submit-batch`,
   piping a JSON array on stdin:
   ```
   node bin/wanikani.js submit-batch <<'EOF'
   [{"assignmentId": 551149968, "wrongMeaning": 0, "wrongReading": 1},
    {"assignmentId": 603114625, "wrongMeaning": 0, "wrongReading": 0}]
   EOF
   ```
   This collapses ~10 round-trips into 1. It returns per-item
   `{assignmentId, ok, endingSrsStage}` (or `{ok: false, error}`) — check for
   any `ok: false` entries and tell the user if something failed to submit;
   don't assume success silently.

   Tradeoff to be aware of: if the session is interrupted mid-batch (before
   the `submit-batch` call runs), nothing has been sent to WaniKani yet for
   that batch — the user just re-answers those items next time, nothing is
   corrupted or double-counted.
8. After submitting, give a one-line batch result (e.g. "10 done, 2 slipped")
   and ask a brief yes/no before fetching more — e.g. "Continue?" — rather
   than auto-chaining into the next batch. Unlike within-batch advancing,
   don't treat a stop-word as a standing preference here; ask every time. On
   yes, run `queue --limit 10` again and keep going; on no (or the queue
   comes back empty), stop and give the final summary: how many reviewed,
   how many perfect (zero wrong attempts on both parts).

Keep the pace conversational — one item's result + the next item's prompt
per message, not a wall of text for the whole batch at once, and keep every
prompt (item prompts, the convention note, the between-batch check) as
short as possible. The goal is fewer *tool calls* and less *waiting on the
user for "next"*, not fewer or shorter chat turns — auto-advancing means
more turns happen back-to-back, which is the point.

## Lessons

`node bin/wanikani.js lessons` prints available lessons (characters,
meanings, mnemonics) but doesn't mark anything started on its own unless
`--start` is passed, which prompts per-item — that flag needs a real
terminal (TTY) so don't run it through a non-interactive shell. If the user
wants to review lesson content conversationally instead (no TTY needed),
run it without `--start`, read the mnemonics back in your own words, and
when they say they've got one, mark it started yourself by calling the
WaniKani API directly is not available as a subcommand yet — the CLI would
need the `--start` prompt flow for that; tell the user to run
`node bin/wanikani.js lessons --start` themselves in a terminal for now.

## Status check

`node bin/wanikani.js summary [--json]` — level, lessons available, reviews
available, and time to next review batch.
