#!/usr/bin/env node
import { parseArgs } from "node:util";
import { WaniKaniClient, resolveToken } from "../lib/client.js";
import { summaryCommand } from "../lib/commands/summary.js";
import { lessonsCommand } from "../lib/commands/lessons.js";
import { reviewCommand } from "../lib/commands/review.js";
import { queueCommand } from "../lib/commands/queue.js";
import { submitCommand } from "../lib/commands/submit.js";

const HELP = `wanikani <command> [options]

Commands:
  summary              Lessons/reviews available, and level
  lessons [--start]     List available lessons; --start prompts to mark each started
  review [--limit N]    Interactive review session (grades meaning/reading, submits results)
  queue [--limit N]     Due reviews as JSON, with answer keys — for Claude to drive the quiz itself
  submit <id> [--wrong-meaning N] [--wrong-reading N]
                        Submit a graded review for one assignment (used by Claude-driven sessions)

Auth:
  Set WANIKANI_API_TOKEN in your environment (Settings → API Tokens on wanikani.com).
`;

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
