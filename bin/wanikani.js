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
import { gradeCommand } from "../lib/commands/grade.js";
import { tipsCommand } from "../lib/commands/tips.js";
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
  queue [--limit N] [--answers]
                        Due reviews as JSON: the questions and their ids, no answers.
                        --answers adds the key back, for debugging this CLI
  explain <id|characters> [--json]
                        Everything WaniKani teaches about one item — mnemonics, hints,
                        what it's built from. The item-info screen, on request
  tips                  Everything you can say during a session, all at once
  grade <subjectId> "<their answer>" [--meaning M] [--reading R] [--forgive meaning|reading]
                        Grade one answer: the verdict, the line to print, and the miss
                        recorded for submit-batch. --forgive takes one back off the
                        record when you overrule it
  submit <id> [--wrong-meaning N] [--wrong-reading N]
                        Submit a graded review for one assignment (used by Claude-driven sessions)
  submit-batch          Submit everything the grade command recorded this batch,
                        in one call

Auth:
  Set WANIKANI_API_TOKEN in your environment (Settings → API Tokens on wanikani.com).
`;

// The dispatch gate, so an unknown name is answered before anything asks for
// a token. Kept next to HELP, which has to list the same set.
const COMMANDS = new Set([
  "summary",
  "lessons",
  "start",
  "review",
  "queue",
  "explain",
  "tips",
  "grade",
  "submit",
  "submit-batch",
]);

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(HELP);
    return;
  }

  // Both of these come before the client, because neither is about the
  // account: a typo'd command name and the tip sheet should answer for
  // themselves rather than demanding a token first.
  if (!COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  if (command === "tips") {
    await tipsCommand();
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
        options: {
          limit: { type: "string" },
          json: { type: "boolean" },
          answers: { type: "boolean" },
        },
      });
      await queueCommand(client, {
        limit: parseCount(values.limit, { flag: "--limit", min: 1 }),
        answers: values.answers,
      });
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
    case "grade": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          meaning: { type: "string" },
          reading: { type: "string" },
          forgive: { type: "string" },
        },
      });
      const subjectId = parseCount(positionals[0], { flag: "<subjectId>", min: 1 });
      if (!subjectId) {
        throw new Error('Usage: wanikani grade <subjectId> "<their answer>" [--meaning M] [--reading R]');
      }
      if (values.forgive && !["meaning", "reading"].includes(values.forgive)) {
        throw new Error("--forgive takes 'meaning' or 'reading'");
      }
      await gradeCommand(client, {
        subjectId,
        answer: positionals.slice(1).join(" "),
        meaning: values.meaning,
        reading: values.reading,
        forgive: values.forgive,
      });
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
      // --graded is the only mode there is now; accepted so the habit of
      // typing it isn't an error, and so is a piped-in list, which is ignored
      // rather than obeyed — the record is the source of the counts.
      parseArgs({ args: rest, options: { graded: { type: "boolean" } } });
      await submitBatchCommand(client);
      break;
    }
    default:
      // Unreachable: COMMANDS gates the dispatch above. Here so that adding a
      // name to that set without a case fails loudly instead of silently.
      throw new Error(`No handler for command: ${command}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
