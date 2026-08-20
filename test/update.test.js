import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCommand } from "../lib/commands/update.js";
import { captureStdout } from "./helpers.js";

/**
 * `update` against real git, on throwaway repos. The interesting part isn't
 * that it pulls — it's the sentence underneath, which is the difference
 * between carrying on and restarting Claude Code. Getting that wrong is
 * silent: a stale skill keeps working, just to older instructions.
 */

const git = (cwd, ...args) => {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
};

/** An origin with one commit, and a clone of it — the shape a user's install is in. */
async function aClonedRepo() {
  const base = await mkdtemp(join(tmpdir(), "wk-update-"));
  const origin = join(base, "origin");
  const clone = join(base, "clone");

  await mkdir(origin);
  git(origin, "init", "--quiet", "--initial-branch=main");
  git(origin, "config", "user.email", "test@example.com");
  git(origin, "config", "user.name", "Test");
  await writeFile(join(origin, "README.md"), "first\n");
  git(origin, "add", ".");
  git(origin, "commit", "--quiet", "-m", "first");

  spawnSync("git", ["clone", "--quiet", origin, clone], { encoding: "utf8" });
  git(clone, "config", "user.email", "test@example.com");
  git(clone, "config", "user.name", "Test");
  return { origin, clone };
}

/** Commits `files` on the origin, so the clone has something to pull. */
async function commitUpstream(origin, message, files) {
  for (const [file, contents] of Object.entries(files)) {
    const full = join(origin, file);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents);
  }
  git(origin, "add", ".");
  git(origin, "commit", "--quiet", "-m", message);
}

test("with nothing to pull it says so, rather than nothing at all", async () => {
  const { clone } = await aClonedRepo();

  const output = await captureStdout(() => updateCommand({ repoRoot: clone }));

  assert.match(output, /Already up to date/);
});

test("a CLI-only change is live immediately, and says so", async () => {
  const { origin, clone } = await aClonedRepo();
  await commitUpstream(origin, "Fix the grading", { "lib/grading.js": "// changed\n" });

  const output = await captureStdout(() => updateCommand({ repoRoot: clone }));

  assert.match(output, /Fix the grading/, "the commits pulled, named");
  assert.match(output, /live now/);
  assert.doesNotMatch(output, /restart Claude Code/, "no restart asked for that isn't needed");
});

test("a change to the skill text asks for the restart it actually needs", async () => {
  const { origin, clone } = await aClonedRepo();
  await commitUpstream(origin, "Rewrite the rules", { ".claude/skills/wanikani/SKILL.md": "# new\n" });

  const output = await captureStdout(() => updateCommand({ repoRoot: clone }));

  assert.match(output, /Rewrite the rules/);
  assert.match(output, /restart Claude Code/);
});

test("a mixed pull errs towards the restart, since the skill did move", async () => {
  const { origin, clone } = await aClonedRepo();
  await commitUpstream(origin, "Both halves", {
    "lib/grading.js": "// changed\n",
    ".claude/skills/wanikani/SKILL.md": "# new\n",
  });

  const output = await captureStdout(() => updateCommand({ repoRoot: clone }));

  assert.match(output, /restart Claude Code/);
});

test("every commit in the range is named, not just the newest", async () => {
  const { origin, clone } = await aClonedRepo();
  await commitUpstream(origin, "First thing", { "lib/a.js": "a\n" });
  await commitUpstream(origin, "Second thing", { "lib/b.js": "b\n" });

  const output = await captureStdout(() => updateCommand({ repoRoot: clone }));

  assert.match(output, /First thing/);
  assert.match(output, /Second thing/);
});

test("a repo with its own commits is refused rather than quietly merged", async () => {
  const { origin, clone } = await aClonedRepo();
  await commitUpstream(origin, "Upstream work", { "lib/a.js": "a\n" });
  // Someone's own commit on the same branch — a fast-forward is off the table,
  // and rearranging their working tree isn't this command's job.
  await writeFile(join(clone, "local.txt"), "mine\n");
  git(clone, "add", ".");
  git(clone, "commit", "--quiet", "-m", "local work");

  const output = await captureStdout(() => updateCommand({ repoRoot: clone }));

  assert.match(output, /^! Pull refused/m);
  assert.match(output, new RegExp(clone), "and says where to go and sort it out");
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test("somewhere that isn't a git repo is a sentence, not a stack trace", async () => {
  const base = await mkdtemp(join(tmpdir(), "wk-update-plain-"));

  const output = await captureStdout(() => updateCommand({ repoRoot: base }));

  assert.match(output, /^! Can't read/m);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});
