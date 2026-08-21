#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { WaniKaniClient, resolveToken } from "../lib/client.js";
import { parseCount, parsePercentage } from "../lib/args.js";
import { summaryCommand } from "../lib/commands/summary.js";
import { reviewCommand } from "../lib/commands/review.js";
import { queueCommand } from "../lib/commands/queue.js";
import { explainCommand } from "../lib/commands/explain.js";
import { gradeCommand } from "../lib/commands/grade.js";
import { gradeManyCommand } from "../lib/commands/gradeMany.js";
import { promptsCommand } from "../lib/commands/prompts.js";
import { tipsCommand } from "../lib/commands/tips.js";
import { statusCommand } from "../lib/commands/status.js";
import { drillCommand } from "../lib/commands/drill.js";
import { criticalCommand } from "../lib/commands/critical.js";
import { submitCommand } from "../lib/commands/submit.js";
import { submitBatchCommand } from "../lib/commands/submitBatch.js";
import { askCommand, answerCommand } from "../lib/commands/session.js";
import { updateCommand } from "../lib/commands/update.js";

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
  review [--limit N]    Interactive review session (grades meaning/reading, submits results)

  The two that drive a Claude-run session — no ids, nothing to track:
  ask [--limit N]       Print the question that's waiting: fetches a batch when there
                        isn't one, re-asks the open item when there is, submits a
                        finished batch before serving the next
  answer "<their whole reply>" [--forgive meaning|reading]
                        Grade that reply against whatever is open, then print the
                        verdict and the next question. --forgive takes the last miss
                        back off the record, no id needed
  queue [--limit N] [--answers] [--restart]
                        Due reviews as JSON: the questions and their ids, no answers.
                        Refuses while answers are graded and unsubmitted, since serving a
                        batch clears them; --restart throws them away on purpose.
                        --answers adds the key back, for debugging this CLI
  drill [--limit N]     The items answered wrong recently, as questions — same shape as
                        queue. A drill: nothing here is due and nothing submits
  critical [--limit N] [--under P]
                        WaniKani's own critical-condition list — every item it has you
                        under 75% correct on, worst first. Same shape as drill, and the
                        same terms: nothing is due and nothing submits. --under moves the
                        line
  prompts               Every question in the current batch that's still unanswered,
                        as one block to print — the rapid-fire list
  explain [<id|characters>] [--json]
                        Everything WaniKani teaches about one item — mnemonics, hints,
                        what it's built from. The item-info screen, on request.
                        With nothing after it, the item that's open
  status [--json]       What the current sitting's record holds — how much of the batch is
                        answered, how much is waiting to be sent, what to call next.
                        Local, so it answers when the API doesn't
  tips                  Everything you can say during a session, all at once
  update                Pull this repo, wherever you ran the command from, and say whether
                        the change needs a Claude Code restart or is already live
  grade <subjectId> "<their answer>" [--meaning M] [--reading R] [--forgive meaning|reading] [--json]
                        Grade one answer. Prints the line to say, and records the miss
                        for submit-batch. --forgive takes one back off the record when
                        you overrule it; --json gives the full verdict
  grade-many "<a> | <b> | ..." [--json]
                        Grade a whole batch answered in one message, in the order
                        prompts listed them. Skips blanks; refuses a reply with more
                        parts than there are open items rather than misaligning them
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
  "update",
  "ask",
  "answer",
  "review",
  "queue",
  "drill",
  "critical",
  "prompts",
  "explain",
  "status",
  "tips",
  "grade",
  "grade-many",
  "submit",
  "submit-batch",
]);

/**
 * Whether a heredoc was fed in — `submit-batch <<'EOF' […] EOF`, which is how
 * a hand-assembled batch of counts arrives. Bash writes a here-document to a
 * temp file, so that's what this looks for: a regular file on fd 0 with
 * something in it.
 *
 * Stat, never read: a command with no use for stdin must not be the reason a
 * session hangs waiting on one. That also rules out recognising a true pipe
 * (`echo … |`), whose size reads as 0 — a miss worth taking, since a false
 * "ignoring your input" printed under every submit would be worse than a
 * warning that catches only the shape actually seen in the wild.
 */
function wasGivenStdin() {
  try {
    if (process.stdin.isTTY) return false;
    const stats = fs.fstatSync(0);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "-h" || command === "--help" || command === "help") {
    console.log(HELP);
    return;
  }

  // These come before the client, because none of them is about the account: a
  // typo'd command name, the tip sheet and the local record should answer for
  // themselves rather than demanding a token first.
  if (!COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  // Neither of these is about the account, and both are most wanted when
  // something else has gone wrong — a broken token shouldn't be the reason you
  // can't ask what's on the record.
  if (command === "tips") {
    await tipsCommand();
    return;
  }

  if (command === "update") {
    await updateCommand();
    return;
  }

  if (command === "status") {
    const { values } = parseArgs({ args: rest, options: { json: { type: "boolean" } } });
    await statusCommand(values);
    return;
  }

  const client = new WaniKaniClient(resolveToken());

  switch (command) {
    case "summary": {
      const { values } = parseArgs({ args: rest, options: { json: { type: "boolean" } } });
      await summaryCommand(client, values);
      break;
    }
    case "review": {
      const { values } = parseArgs({ args: rest, options: { limit: { type: "string" } } });
      await reviewCommand(client, { limit: parseCount(values.limit, { flag: "--limit", min: 1 }) });
      break;
    }
    case "ask": {
      const { values } = parseArgs({ args: rest, options: { limit: { type: "string" } } });
      await askCommand(client, { limit: parseCount(values.limit, { flag: "--limit", min: 1 }) });
      break;
    }
    case "answer": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { forgive: { type: "string" } },
      });
      if (values.forgive && !["meaning", "reading"].includes(values.forgive)) {
        throw new Error("--forgive takes 'meaning' or 'reading'");
      }
      if (!values.forgive && !positionals[0]) {
        throw new Error('Usage: wanikani answer "<their whole reply>" [--forgive meaning|reading]');
      }
      await answerCommand(client, { reply: positionals[0], forgive: values.forgive });
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
          restart: { type: "boolean" },
        },
      });
      await queueCommand(client, {
        limit: parseCount(values.limit, { flag: "--limit", min: 1 }),
        answers: values.answers,
        restart: values.restart,
      });
      break;
    }
    case "drill": {
      const { values } = parseArgs({ args: rest, options: { limit: { type: "string" } } });
      await drillCommand(client, { limit: parseCount(values.limit, { flag: "--limit", min: 1 }) ?? 10 });
      break;
    }
    case "critical": {
      const { values } = parseArgs({
        args: rest,
        options: { limit: { type: "string" }, under: { type: "string" } },
      });
      await criticalCommand(client, {
        limit: parseCount(values.limit, { flag: "--limit", min: 1 }) ?? 10,
        under: parsePercentage(values.under),
      });
      break;
    }
    case "prompts": {
      parseArgs({ args: rest, options: {} });
      await promptsCommand(client);
      break;
    }
    case "explain": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json: { type: "boolean" } },
      });
      // No argument means the item that's open — see explain.js. Only an
      // explicit empty string is a mistake worth refusing.
      const target = positionals[0];
      if (target === "") throw new Error("Usage: wanikani explain [<subjectId|characters>] [--json]");
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
          json: { type: "boolean" },
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
        json: values.json,
      });
      break;
    }
    case "grade-many": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json: { type: "boolean" } },
      });
      const answers = positionals.join(" ");
      if (!answers.trim()) {
        throw new Error('Usage: wanikani grade-many "<answer> | <answer> | ..."');
      }
      await gradeManyCommand(client, { answers, json: values.json });
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
      const pipedIn = wasGivenStdin();
      if (pipedIn) {
        // Silently ignoring it read as accepting it: one session piped a
        // hand-assembled batch of counts into every submit for a whole
        // sitting, and the counts it typed disagreed with the record more
        // than once. Say it's going in the bin.
        console.error(
          "! Ignoring the piped-in list — submit-batch takes no counts. It submits what `grade` " +
            "recorded, so an answer missing from the record needs grading, not adding by hand.",
        );
      }
      await submitBatchCommand(client, { ignoredStdin: pipedIn });
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
