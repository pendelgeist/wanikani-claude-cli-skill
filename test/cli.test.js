import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), "bin", "wanikani.js");

/**
 * Nothing else in the suite loads `bin/wanikani.js` — the commands are tested
 * through their modules — so a syntax error in the entry point itself sailed
 * past a green run once. These execute it for real.
 */
const cli = (...args) => run(process.execPath, [CLI, ...args], { env: { ...process.env } });

test("the CLI runs and prints its usage", async () => {
  const { stdout } = await cli("--help");

  assert.match(stdout, /^wanikani <command> \[options\]/);
  for (const command of ["summary", "lessons", "review", "queue", "grade", "explain", "tips", "submit-batch"]) {
    assert.ok(stdout.includes(`  ${command}`), `${command} is missing from the help`);
  }
});

test("an unknown command says so and exits non-zero", async () => {
  await assert.rejects(() => cli("nonsense"), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /Unknown command: nonsense/);
    return true;
  });
});

test("tips runs without a token, since it's about the tool and not the account", async () => {
  const { stdout } = await run(process.execPath, [CLI, "tips"], {
    env: { ...process.env, WANIKANI_API_TOKEN: "" },
  });

  assert.match(stdout, /What you can say:/);
});

const KANJI = {
  id: 3,
  object: "kanji",
  data: {
    level: 2,
    characters: "親",
    document_url: "https://www.wanikani.com/kanji/親",
    meanings: [{ meaning: "Parent", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [
      { type: "onyomi", primary: true, accepted_answer: true, reading: "しん" },
      { type: "kunyomi", primary: false, accepted_answer: false, reading: "おや" },
    ],
  },
};

/**
 * A cache warm enough that the local commands need no network — which is also
 * how they run mid-session, one batch after `queue`.
 */
async function withWarmCache(fn) {
  const dir = await mkdtemp(join(tmpdir(), "wanikani-cli-test-"));
  const now = new Date().toISOString();
  await writeFile(join(dir, "subjects.json"), JSON.stringify({ subjects: { 3: KANJI }, refreshedAt: now }));
  await writeFile(
    join(dir, "queue-order.json"),
    JSON.stringify({ fetchedAt: now, items: [{ assignmentId: 77, subjectId: 3 }], totals: {}, grades: {} }),
  );
  const env = { ...process.env, WANIKANI_CACHE_DIR: dir, WANIKANI_API_TOKEN: "test-token" };
  try {
    return await fn((...args) => run(process.execPath, [CLI, ...args], { env }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("grade's flags reach the command, and the answer round-trips through argv", async () => {
  await withWarmCache(async (wk) => {
    const whole = JSON.parse((await wk("grade", "3", "parent, oya", "--json")).stdout);
    assert.equal(whole.reading, "other-reading");
    assert.equal(whole.open, true);

    const half = JSON.parse((await wk("grade", "3", "--reading", "shin", "--json")).stdout);
    assert.deepEqual([half.meaning, half.reading], [null, "correct"]);

    const forgiven = JSON.parse((await wk("grade", "3", "--forgive", "reading", "--json")).stdout);
    assert.equal(forgiven.forgave, "reading");
  });
});

test("a --forgive it can't act on is refused rather than guessed at", async () => {
  await withWarmCache(async (wk) => {
    await assert.rejects(() => wk("grade", "3", "--forgive", "everything"), (err) => {
      assert.match(err.stderr, /--forgive takes 'meaning' or 'reading'/);
      return true;
    });
  });
});

test("submit-batch --graded returns without waiting on a stdin that never comes", async () => {
  // The heredoc form reads stdin; --graded must not, or a session that calls
  // it without one hangs forever with no output and no way to tell why.
  await withWarmCache(async (wk) => {
    const { stdout } = await wk("submit-batch", "--graded");

    assert.match(JSON.parse(stdout).summaryLine, /Nothing submitted — no grades on record/);
  });
});

test("a bad --limit is refused before anything is fetched", async () => {
  await withWarmCache(async (wk) => {
    await assert.rejects(() => wk("queue", "--limit", "lots"), (err) => {
      assert.match(err.stderr, /--limit expects a whole number/);
      return true;
    });
  });
});
