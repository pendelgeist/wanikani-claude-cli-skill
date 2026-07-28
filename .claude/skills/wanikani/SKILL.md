---
name: wanikani
description: Run a WaniKani lesson or review session from Claude Code, using the wanikani CLI in this repo to talk to the WaniKani API. Trigger on "/wanikani", "do my wanikani reviews", "wanikani lessons", or similar requests to study kanji via WaniKani.
---

# WaniKani study session

This repo is a small CLI (`bin/wanikani.js`) that talks to the WaniKani API
(https://api.wanikani.com/v2). It needs `WANIKANI_API_TOKEN` set in the
environment — if a run fails with "No API token found", ask the user to run
`export WANIKANI_API_TOKEN=...` (from wanikani.com → Settings → API Tokens)
and try again.

The token needs the `reviews:create` permission checked for `submit`/`review`
to work, and `assignments:start` for `lessons --start`. If a write call fails
with 403, that's almost certainly a missing permission checkbox on the token
(see README.md) — tell the user which one, don't just retry.

Run all commands from the repo root with `node bin/wanikani.js <command>`.
Run `npm install` first if `node_modules/wanakana` doesn't exist yet.

## Reviews (the main flow)

Drive the quiz yourself in chat, rather than shelling out to the interactive
`review` command — you can use judgment on typos/phrasing that a rigid string
match would reject, which is a better experience than the raw CLI.

1. Run `node bin/wanikani.js queue` and parse the JSON. Each item has
   `assignmentId`, `characters` (or null for some radicals — use
   `documentUrl` to describe it instead), `needsReading`, `meanings`,
   `auxiliaryMeanings` (type `whitelist` = also acceptable, `blacklist` =
   looks plausible but is wrong), and `readings` (only the ones with
   `accepted_answer: true` are correct).
2. If the queue is empty, tell the user there's nothing due right now and stop.
3. For each item, ask for the meaning in one message (e.g. "猫 — meaning?").
   Judge correctness against `meanings`/`auxiliaryMeanings` yourself — accept
   reasonable synonyms and minor typos, reject anything matching a `blacklist`
   entry even if it seems plausible. If wrong, say so and let them retry;
   keep a count of how many wrong attempts happened for this item.
4. If `needsReading` is true, do the same for the reading (kana). Accept kana
   or romaji from the user; compare against `readings`.
5. Once both parts are answered (or the user gives up on one — count a
   giveup as one wrong attempt), submit immediately:
   `node bin/wanikani.js submit <assignmentId> --wrong-meaning N --wrong-reading N`.
   Don't batch submissions until the end — submitting per-item means progress
   isn't lost if the session gets interrupted.
6. After the last item, summarize: how many reviewed, how many perfect
   (zero wrong attempts on both parts).

Keep the pace conversational — one item at a time, don't dump the whole
queue as a wall of text.

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
