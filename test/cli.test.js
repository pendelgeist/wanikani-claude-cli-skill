import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

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
