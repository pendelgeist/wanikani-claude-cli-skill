---
name: wanikani
description: Run a WaniKani lesson or review session from Claude Code, using the wanikani CLI in this repo to talk to the WaniKani API. Trigger on "/wanikani", "do my wanikani reviews", "wanikani lessons", or similar requests to study kanji via WaniKani.
---

# WaniKani study session

This repo is a small CLI (`bin/wanikani.js`) that talks to the WaniKani API
(https://api.wanikani.com/v2). It needs `WANIKANI_API_TOKEN` available to the
process.

**Never put the token value directly in a Bash command** (e.g.
`export WANIKANI_API_TOKEN=<value> && node ...`) — that value gets echoed
verbatim into the visible tool call, and from there into logs/transcripts,
so it's effectively a leak. Instead:

- First try running a command plain: `node bin/wanikani.js summary`. If the
  user's shell already has `WANIKANI_API_TOKEN` exported (e.g. from their
  `.bashrc`), this just works and needs nothing further from you.
- If that fails with "No API token found", check for a `.env` file in the
  repo root. If it exists, run commands with
  `node --env-file=.env bin/wanikani.js <command>` instead.
- If there's no `.env` either, tell the user to run
  `cp .env.example .env` and paste their token into it (wanikani.com →
  Settings → API Tokens), then retry with `--env-file=.env`. Do not ask them
  to paste the token into the chat, and do not type it into a command yourself.

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

1. Run `node bin/wanikani.js queue --limit 10` and parse the JSON — fetch in
   batches of ~10 rather than one at a time (there can be hundreds due; one
   `queue` call per item wastes a round-trip per review for no benefit, since
   you already have the next 9 answer keys in hand). Each item has
   `assignmentId`, `characters` (or null for some radicals — use
   `documentUrl` to describe it instead), `needsReading`, `meanings`,
   `auxiliaryMeanings` (type `whitelist` = also acceptable, `blacklist` =
   looks plausible but is wrong), and `readings` (only the ones with
   `accepted_answer: true` are correct). When the batch is exhausted, run
   `queue --limit 10` again — items just submitted have moved out of the
   due queue, so this naturally returns the next batch, not repeats.
2. If the queue is empty, tell the user there's nothing due right now and stop.
3. Prompt each item so it's clear both parts can be answered together in one
   line. For items with `needsReading: true`: "毛 — meaning (and reading, if
   you want both at once)?" For meaning-only items (radicals,
   kana_vocabulary): just "meaning?". A reply like "fur, ke" or "fur / ke" or
   even just "fur ke" on one line should grade both parts from that single
   message — don't make the user split it into two turns unless they want to.
   Parse whichever part looks like a reading (kana, or romaji per `readings`)
   as the reading and the rest as the meaning; order doesn't matter ("ke fur"
   works the same as "fur, ke"). If they only gave the meaning, grade that and
   ask "Reading?" as a quick follow-up.
4. Judge both parts against the item's own data, not exact string matching:
   meaning against `meanings`/`auxiliaryMeanings` (accept reasonable synonyms
   and minor typos; reject anything matching a `blacklist` entry even if it
   seems plausible), reading against `readings` (accept kana or romaji). Keep
   a running count of wrong attempts per item, per part.
5. **Auto-advance by default**: whether an item was right or wrong, say so
   briefly and move straight into the next item's prompt in the same
   message — don't wait for the user to say "next" or "continue" between
   items. Only pause the advance if the user explicitly asks to slow down,
   review an answer, or stop (e.g. "wait", "hold on", "explain that one") —
   treat that as a standing preference for the rest of the session once
   they've said it, not a one-off.
6. Track each item's `wrongMeaning`/`wrongReading` counts in your own head as
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
7. Fetch the next `queue --limit 10` batch and repeat until the queue comes
   back empty, then summarize: how many reviewed, how many perfect (zero
   wrong attempts on both parts).

Keep the pace conversational — one item's result + the next item's prompt
per message, not a wall of text for the whole batch at once. The goal is
fewer *tool calls* and less *waiting on the user for "next"*, not fewer or
shorter chat turns — auto-advancing means more turns happen back-to-back,
which is the point.

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
