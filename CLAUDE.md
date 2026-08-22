# Working on this repo

- **A change to behaviour goes in `CHANGELOG.md` in the same PR.** Anything
  under `lib/`, `bin/` or `.claude/skills/` counts; a README pass, a test or a
  workflow doesn't. Write the entry as part of the work rather than as a fixup
  after CI: an entry composed later comes out of the commit log, and a
  changelog of subject lines is what this one exists instead of. It says what
  changed for whoever is doing reviews, filed under today's date — added to
  today's section if one is already there, since two sections for one day is a
  test failure. `[no changelog]` in the PR body is the escape hatch, for a
  change nobody reviewing could notice.
- **`npm test` is the whole check.** No linter, no formatter. The API is
  stubbed throughout and anything that writes is pointed at a temp directory,
  so it runs offline.
- **Read `.claude/skills/wanikani/FAILURES.md` before changing how the review
  loop is shaped** — every rule in `SKILL.md` is there because a real sitting
  went wrong without it. Don't read it *during* a sitting; it's design
  history, not instructions.
- Match the surrounding prose. Comments here explain why a thing is the shape
  it is, usually by naming what went wrong when it wasn't.
