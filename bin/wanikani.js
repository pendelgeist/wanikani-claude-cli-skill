#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WaniKaniClient, resolveToken } from "../lib/client.js";
import { parseCount } from "../lib/args.js";
import { summaryCommand } from "../lib/commands/summary.js";
import { lessonsCommand } from "../lib/commands/lessons.js";
import { reviewCommand } from "../lib/commands/review.js";
import { queueCommand } from "../lib/commands/queue.js";
import { explainCommand } from "../lib/commands/explain.js";
import { submitCommand } from "../lib/commands/submit.js";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";
import { startCommand } from "../lib/commands/start.js";

// Auto-load the repo's .env (if present) so WANIKANI_API_TOKEN doesn't
// require --env-file or a pre-exported shell var. Doesn't override a
// value already set in the environment. (loadEnvFile landed in Node 20.12;
// on anything older the .env just isn't read.)
if (typeof process.loadEnvFile === "function") {
  try {
    const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    process.loadEnvFile(path.join(repoRoot, ".env"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

const HELP = `wanikani <command> [options]

Commands:
  summary [--json]      Lessons/reviews available, next review time, and level
  lessons [--json] [--limit N] [--start]
                        Available lessons (--json includes mnemonics and assignment ids
                        for a Claude-driven session; --start prompts to mark each started,
                        which needs a real terminal)
  start <id> [<id>...]  Mark lesson assignments as started — the non-interactive
                        counterpart to lessons --start
  review [--limit N]    Interactive review session (grades meaning/reading, submits results)
  queue [--limit N]     Due reviews as JSON, with answer keys — for Claude to drive the quiz itself
  explain <id|characters> [--json]
                        Everything WaniKani teaches about one item — mnemonics, hints,
                        what it's built from. The item-info screen, on request
  submit <id> [--wrong-meaning N] [--wrong-reading N]
                        Submit a graded review for one assignment (used by Claude-driven sessions)
  submit-batch          Submit several graded reviews in one call — reads a JSON array of
                        {assignmentId, wrongMeaning, wrongReading} from stdin

Auth:
  Set WANIKANI_API_TOKEN in your environment (Settings → API Tokens on wanikani.com).
`;

async function readStdin() {
  if (process.stdin.isTTY) {
    throw new Error(
      "submit-batch reads a JSON array on stdin — pipe one in, e.g.:\n" +
        `  echo '[{"assignmentId": 1, "wrongMeaning": 0, "wrongReading": 0}]' | wanikani submit-batch`,
    );
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(HELP);
    return;
  }

  const client = new WaniKaniClient(resolveToken());

  switch (command) {
    case "summary": {
      const { values } = parseArgs({ args: rest, options: { json: { type: "boolean" } } });
      await summaryCommand(client, values);
      break;
    }
    case "lessons": {
      const { values } = parseArgs({
        args: rest,
        options: { start: { type: "boolean" }, limit: { type: "string" }, json: { type: "boolean" } },
      });
      await lessonsCommand(client, { ...values, limit: parseCount(values.limit, { flag: "--limit", min: 1 }) });
      break;
    }
    case "review": {
      const { values } = parseArgs({ args: rest, options: { limit: { type: "string" } } });
      await reviewCommand(client, { limit: parseCount(values.limit, { flag: "--limit", min: 1 }) });
      break;
    }
    case "queue": {
      // `queue` only ever prints JSON; --json is accepted and ignored so the
      // reflex of passing it isn't a hard error mid-session.
      const { values } = parseArgs({
        args: rest,
        options: { limit: { type: "string" }, json: { type: "boolean" } },
      });
      await queueCommand(client, { limit: parseCount(values.limit, { flag: "--limit", min: 1 }) });
      break;
    }
    case "explain": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json: { type: "boolean" } },
      });
      const target = positionals[0];
      if (!target) throw new Error("Usage: wanikani explain <subjectId|characters> [--json]");
      await explainCommand(client, { target, json: values.json });
      break;
    }
    case "start": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} });
      const assignmentIds = positionals.map((id) => parseCount(id, { flag: "<assignmentId>", min: 1 }));
      if (assignmentIds.length === 0) {
        throw new Error("Usage: wanikani start <assignmentId> [<assignmentId>...]");
      }
      await startCommand(client, { assignmentIds });
      break;
    }
    case "submit": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          "wrong-meaning": { type: "string", default: "0" },
          "wrong-reading": { type: "string", default: "0" },
        },
      });
      const assignmentId = parseCount(positionals[0], { flag: "<assignmentId>", min: 1 });
      if (!assignmentId) {
        throw new Error("Usage: wanikani submit <assignmentId> [--wrong-meaning N] [--wrong-reading N]");
      }
      await submitCommand(client, {
        assignmentId,
        wrongMeaning: parseCount(values["wrong-meaning"], { flag: "--wrong-meaning" }),
        wrongReading: parseCount(values["wrong-reading"], { flag: "--wrong-reading" }),
      });
      break;
    }
    case "submit-batch": {
      const raw = await readStdin();
      let items;
      try {
        items = JSON.parse(raw);
      } catch {
        throw new Error("submit-batch expects a JSON array on stdin: [{assignmentId, wrongMeaning, wrongReading}, ...]");
      }
      if (!Array.isArray(items)) {
        throw new Error("submit-batch expects a JSON array on stdin, got: " + typeof items);
      }
      await submitBatchCommand(client, items);
      break;
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
