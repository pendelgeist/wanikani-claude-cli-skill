#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WaniKaniClient, resolveToken } from "../lib/client.js";
import { summaryCommand } from "../lib/commands/summary.js";
import { lessonsCommand } from "../lib/commands/lessons.js";
import { reviewCommand } from "../lib/commands/review.js";
import { queueCommand } from "../lib/commands/queue.js";
import { submitCommand } from "../lib/commands/submit.js";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";

// Auto-load the repo's .env (if present) so WANIKANI_API_TOKEN doesn't
// require --env-file or a pre-exported shell var. Doesn't override a
// value already set in the environment.
try {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

const HELP = `wanikani <command> [options]

Commands:
  summary              Lessons/reviews available, and level
  lessons [--start]     List available lessons; --start prompts to mark each started
  review [--limit N]    Interactive review session (grades meaning/reading, submits results)
  queue [--limit N]     Due reviews as JSON, with answer keys — for Claude to drive the quiz itself
  submit <id> [--wrong-meaning N] [--wrong-reading N]
                        Submit a graded review for one assignment (used by Claude-driven sessions)
  submit-batch          Submit several graded reviews in one call — reads a JSON array of
                        {assignmentId, wrongMeaning, wrongReading} from stdin

Auth:
  Set WANIKANI_API_TOKEN in your environment (Settings → API Tokens on wanikani.com).
`;

async function readStdin() {
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
      const { values } = parseArgs({ args: rest, options: { start: { type: "boolean" } } });
      await lessonsCommand(client, values);
      break;
    }
    case "review": {
      const { values } = parseArgs({ args: rest, options: { limit: { type: "string" } } });
      await reviewCommand(client, { limit: values.limit ? Number(values.limit) : undefined });
      break;
    }
    case "queue": {
      const { values } = parseArgs({ args: rest, options: { limit: { type: "string" } } });
      await queueCommand(client, { limit: values.limit ? Number(values.limit) : undefined });
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
      const assignmentId = Number(positionals[0]);
      if (!assignmentId) {
        throw new Error("Usage: wanikani submit <assignmentId> [--wrong-meaning N] [--wrong-reading N]");
      }
      await submitCommand(client, {
        assignmentId,
        wrongMeaning: Number(values["wrong-meaning"]),
        wrongReading: Number(values["wrong-reading"]),
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
