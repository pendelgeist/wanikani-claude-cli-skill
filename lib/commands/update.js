import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Pulls this repo, from wherever the CLI happens to have been run.
 *
 * "update wanikani from origin" was a request nobody could serve: the repo
 * isn't in the workspace a session is usually started from, so the answer was
 * "which directory?" and the person who knew had to go and type it. The CLI
 * has always known — it resolves its own root to find `.env` — so this is that
 * same answer, used for the other thing it's good for.
 *
 * It reports whether the skill text moved, because that is the difference
 * between "carry on" and "restart Claude Code", and getting it wrong is not
 * loud: a stale skill keeps working, just to last month's instructions. One
 * ran four releases behind for three weeks that way.
 */
export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Where the skill text lives, relative to the repo root. A change under here
// is one Claude Code only picks up when it next starts.
const SKILL_PATH = ".claude/skills/";

export async function updateCommand({ repoRoot = REPO_ROOT } = {}) {
  const git = (...args) => spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });

  const before = git("rev-parse", "HEAD");
  if (before.error || before.status !== 0) {
    console.log(`! Can't read ${repoRoot} as a git repo — ${reason(before)}`);
    process.exitCode = 1;
    return;
  }

  // `--ff-only` so a repo with its own commits in it says so rather than
  // being quietly merged. Someone else's working tree is not this command's
  // to rearrange.
  const pull = git("pull", "--ff-only");
  if (pull.status !== 0) {
    console.log(`! Pull refused — ${reason(pull)}`);
    console.log(`The repo is at ${repoRoot}; sort it out there and run this again.`);
    process.exitCode = 1;
    return;
  }

  const after = git("rev-parse", "HEAD").stdout.trim();
  if (before.stdout.trim() === after) {
    console.log("Already up to date.");
    return;
  }

  const range = `${before.stdout.trim()}..${after}`;
  const commits = git("log", "--oneline", "--no-decorate", range).stdout.trim();
  const changed = git("diff", "--name-only", range).stdout.trim().split("\n").filter(Boolean);

  console.log(commits || `Updated to ${after.slice(0, 7)}.`);
  console.log(
    changed.some((file) => file.startsWith(SKILL_PATH))
      ? "\nThe skill text changed — restart Claude Code to pick it up."
      : "\nCLI only, so it's live now — no restart needed.",
  );
}

/** Whatever git said about why, on one line. */
function reason(result) {
  if (result.error) return result.error.code === "ENOENT" ? "git isn't on the PATH" : result.error.message;
  return (result.stderr || result.stdout || "").trim().split("\n")[0] || `git exited ${result.status}`;
}
