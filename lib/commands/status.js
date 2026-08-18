import { formatAgo } from "../format.js";
import { loadSitting, loadQueueOrder, openItems } from "../queueOrder.js";

/**
 * What the sitting's record holds right now, and the one call to make next.
 *
 * "Is that submitted?" is a question about a file, and it kept being answered
 * from memory instead. One session lost four batches to its own `queue` calls,
 * couldn't tell what had landed, and reported to the user that the CLI was
 * "broken/unreliable" and the remaining forty items should be done on the
 * website — when the record could have said, in one local call, exactly how
 * many answers were waiting and that nothing had been lost.
 *
 * So this reads the record and says what's in it. No token, no network: it has
 * to answer when the API doesn't, because that's when it gets asked.
 */
export async function statusCommand({ json = false } = {}) {
  const state = await sittingState();
  console.log(json ? JSON.stringify(state, null, 2) : statusReport(state));
}

async function sittingState() {
  const sitting = await loadSitting();
  if (!sitting) return { sitting: false };

  const live = (await loadQueueOrder()) !== null;
  const grades = Object.entries(sitting.grades ?? {}).map(([assignmentId, counts]) => ({
    assignmentId: Number(assignmentId),
    ...counts,
  }));
  const settled = grades.filter((grade) => !grade.awaiting);
  const open = (await openItems()) ?? [];

  return {
    sitting: true,
    stale: !live,
    due: sitting.items.length,
    touchedAt: sitting.touchedAt ?? sitting.fetchedAt,
    asked: (sitting.served ?? []).length,
    onRecord: settled.length,
    withMiss: settled.filter((grade) => grade.wrongMeaning > 0 || grade.wrongReading > 0).length,
    open: open.length,
    openPositions: open.map((item) => item.position),
    sessionSubmitted: sitting.totals?.submitted ?? 0,
    sessionPerfect: sitting.totals?.perfect ?? 0,
  };
}

/**
 * The next call, in the order the loop takes them. It's the line worth having:
 * a session that has lost its place reaches for a theory, and a theory it can
 * act on beats one it has to invent.
 */
function nextCall(state) {
  if (state.stale) return "`queue --limit 10` starts a fresh sitting.";
  // In the order the loop takes them: finish the batch, then send it.
  const steps = [];
  if (state.open > 0) steps.push(`\`prompts\` re-asks the ${state.open} still open`);
  if (state.onRecord > 0) steps.push(`\`submit-batch\` sends the ${state.onRecord} on record`);
  if (steps.length === 0) steps.push("`queue --limit 10` fetches the next batch");
  return `${steps.join(", then ")}.`;
}

export function statusReport(state) {
  if (!state.sitting) {
    return "No sitting on disk — nothing is part-answered, and nothing is waiting to be sent. `queue --limit 10` starts one.";
  }

  const lines = [];
  const age = formatAgo(state.touchedAt);

  if (state.stale) {
    lines.push(
      `Sitting: idle ${age}, past its 30-minute life. The next \`queue\` fetches a fresh list and ` +
        `drops what's on this record${state.onRecord ? ` (${state.onRecord} answer${state.onRecord === 1 ? "" : "s"})` : ""} — those items stay due.`,
    );
  } else {
    lines.push(`Sitting: ${state.due} still due in this queue, last touched ${age} ago.`);
    if (state.asked > 0) {
      lines.push(
        `Batch: ${state.asked} asked · ${state.onRecord} answered · ${state.open} still open` +
          (state.open > 0 ? ` (${state.openPositions.join(", ")})` : "") +
          ".",
      );
    }
    lines.push(
      state.onRecord > 0
        ? `On record and not sent: ${state.onRecord} answer${state.onRecord === 1 ? "" : "s"}, ` +
          `${state.withMiss} carrying a miss.`
        : "On record and not sent: nothing.",
    );
  }

  if (state.sessionSubmitted > 0) {
    const when = state.stale ? "Sent before it went idle" : "Sent this sitting";
    lines.push(`${when}: ${state.sessionSubmitted} submitted, ${state.sessionPerfect} perfect.`);
  }

  lines.push(`Next: ${nextCall(state)}`);
  // The two facts a lost session most needs and least believes: answering
  // doesn't send, and losing the record doesn't lose the review.
  lines.push(
    "Nothing reaches WaniKani until `submit-batch`, and nothing is lost meanwhile — an item stays due until it's submitted.",
  );
  return lines.join("\n");
}
