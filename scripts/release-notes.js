#!/usr/bin/env node
// Prints release notes for FROM..TO (defaults: the last tag..HEAD) as a clean
// bullet list, from what CHANGELOG.md gained in that range. Used by the
// release workflow; runnable by hand to see what the next release would say.
import { spawnSync } from "node:child_process";
import { formatEntries, newEntries } from "../lib/changelog.js";

const git = (...args) => spawnSync("git", args, { encoding: "utf8" });
const [from = git("describe", "--tags", "--abbrev=0").stdout.trim(), to = "HEAD"] = process.argv.slice(2);

const show = (ref) => (ref ? git("show", `${ref}:CHANGELOG.md`).stdout : "");
const entries = newEntries(show(from), show(to));

if (entries.length) {
  console.log(formatEntries(entries, { headings: false }));
} else {
  // Nothing written up: fall back to the commit subjects, minus merge commits.
  const range = from ? `${from}..${to}` : to;
  const subjects = git("log", "--no-merges", "--format=- %s", range).stdout.trim();
  console.log(subjects || "No user-facing changes.");
}
