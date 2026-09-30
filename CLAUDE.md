# Working in this repo

## Every user-facing change gets a `CHANGELOG.md` entry

Every push to `main` is a release, and the release notes are the bold lead of
each bullet `CHANGELOG.md` gained. Nothing else writes them: with no entry,
`wanikani update` falls back to commit subjects and the release body says
"No user-facing changes."

So in the same PR as any change under `lib/`, `bin/` or `.claude/skills/`:

- Add a bullet under today's `## YYYY-MM-DD` heading (newest section first).
- Start it with a **bold one-line summary** — that line is the release note.
  The rest is for people reading the file: what changed for whoever is doing
  the reviews, and what went wrong that prompted it.

CI fails a PR that touches those paths without touching `CHANGELOG.md`. For a
refactor, test-only or docs-only change that really has nothing to say, put
`[no changelog]` in the PR title or body.

## Tests

`npm test` — run it before pushing, not after.
