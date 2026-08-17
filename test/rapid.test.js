import { test } from "node:test";
import assert from "node:assert/strict";
import { queueCommand } from "../lib/commands/queue.js";
import { promptsCommand } from "../lib/commands/prompts.js";
import { gradeManyCommand, splitReplies } from "../lib/commands/gradeMany.js";
import { loadGrades, openItems } from "../lib/queueOrder.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

const KANJI = {
  id: 11,
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

const VOCAB = {
  id: 12,
  object: "vocabulary",
  data: {
    level: 3,
    characters: "心強い",
    document_url: "https://www.wanikani.com/vocabulary/心強い",
    meanings: [{ meaning: "Reassuring", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [{ reading: "こころづよい", primary: true, accepted_answer: true }],
  },
};

const RADICAL = {
  id: 13,
  object: "radical",
  data: {
    level: 1,
    characters: null,
    character_images: [{ url: "https://img/hook.png", content_type: "image/png", metadata: {} }],
    document_url: "https://www.wanikani.com/radicals/hook",
    meanings: [{ meaning: "Hook", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
  },
};

const SUBJECTS = [KANJI, VOCAB, RADICAL];

// Assignment ids are 900 + the subject's index here; the queue shuffles, so
// every expectation below is looked up rather than assumed.
const ASSIGNMENT = new Map(SUBJECTS.map((subject, index) => [subject.id, 900 + index]));
const RIGHT = { 11: "parent, shin", 12: "reassuring, kokoroduyoi", 13: "hook" };
const WRONG_READING = { 12: "reassuring, kokorozuyoi" };

const client = {
  async getAssignments() {
    return SUBJECTS.map((subject) => ({ id: ASSIGNMENT.get(subject.id), data: { subject_id: subject.id } }));
  },
  async getSubjectsByIds(ids) {
    return new Map(ids.map((id) => [id, SUBJECTS.find((s) => s.id === id)]).filter(([, s]) => s));
  },
};

/**
 * A sitting with the batch already handed out, as `queue` leaves it. `fn` gets
 * the batch in the order it was asked, so tests can say "the vocabulary one"
 * without depending on where the shuffle put it.
 */
async function inABatch(fn) {
  return withTempCacheDir(async () => {
    const batch = JSON.parse(await captureStdout(() => queueCommand(client, { limit: 3 })));
    const positionOf = (subjectId) => batch.findIndex((item) => item.subjectId === subjectId) + 1;
    return fn({ batch, positionOf, order: batch.map((item) => item.subjectId) });
  });
}

test("the batch is a thing the CLI knows, not something the caller holds", async () => {
  const { open, order } = await inABatch(async ({ order }) => ({ open: await openItems(), order }));

  assert.deepEqual(
    open.map((item) => [item.position, item.subjectId]),
    order.map((subjectId, index) => [index + 1, subjectId]),
    "in the order they were asked, numbered the way they were asked",
  );
});

test("the rapid list is every open prompt and no answers", async () => {
  const { block, positionOf } = await inABatch(async (batch) => ({
    block: await captureStdout(() => promptsCommand(client)),
    positionOf: batch.positionOf,
  }));

  assert.match(block, new RegExp(`^${positionOf(11)}\\. 親$`, "m"));
  assert.match(block, new RegExp(`^${positionOf(12)}\\. 心強い$`, "m"));
  // A glyph-less radical is its image URL, same as its one-at-a-time prompt:
  // naming it ("Hook radical") is naming the answer.
  assert.match(block, new RegExp(`^${positionOf(13)}\\. https://img/hook\\.png$`, "m"));
  assert.doesNotMatch(block, /Parent|Reassuring|Hook|しん|こころづよい/);
});

test("a whole batch answered in one message grades in one call", async () => {
  const { out, grades, positionOf } = await inABatch(async ({ order, positionOf }) => {
    const answers = order.map((subjectId) => WRONG_READING[subjectId] ?? RIGHT[subjectId]).join(" | ");
    const out = await captureStdout(() => gradeManyCommand(client, { answers }));
    return { out, grades: await loadGrades(), positionOf };
  });

  assert.match(out, new RegExp(`^${positionOf(11)}\\. 親 ✓$`, "m"));
  assert.match(out, new RegExp(`^${positionOf(12)}\\. 心強い ✗ reading is こころづよい · `, "m"));
  assert.match(out, new RegExp(`^${positionOf(13)}\\. ✓$`, "m"), "a glyph-less radical goes by its number");
  assert.deepEqual(grades, {
    [ASSIGNMENT.get(11)]: { wrongMeaning: 0, wrongReading: 0 },
    [ASSIGNMENT.get(12)]: { wrongMeaning: 0, wrongReading: 1 },
    [ASSIGNMENT.get(13)]: { wrongMeaning: 0, wrongReading: 0 },
  });
});

test("the how-to for answering a list is said once, on whichever list comes first", async () => {
  // The suppression rule used to be "only on a full list", which meant the
  // one case it's actually needed for — a batch that went one-at-a-time and
  // then switched — was the one case it never appeared in.
  const { partial, next } = await inABatch(async ({ order }) => {
    await captureStdout(() => gradeManyCommand(client, { answers: RIGHT[order[0]] }));
    return {
      partial: await captureStdout(() => promptsCommand(client)),
      next: await captureStdout(() => promptsCommand(client)),
    };
  });

  assert.match(partial, /separated by "\|"/);
  assert.doesNotMatch(next, /separated by "\|"/, "and not under every list after it");
});

test("answered items drop out of the list, and the rest keep their numbers", async () => {
  const { block, answered } = await inABatch(async ({ order }) => {
    await captureStdout(() => gradeManyCommand(client, { answers: RIGHT[order[0]] }));
    return { block: await captureStdout(() => promptsCommand(client)), answered: order[0] };
  });

  const characters = { 11: "親", 12: "心強い", 13: "https://img/hook.png" }[answered];
  assert.doesNotMatch(block, new RegExp(characters.replace(/[/.]/g, "\\$&")), "already answered");
  // Item 3 is item 3 for the whole batch — renumbering what's left would make
  // "still open: 2, 3" and the next list disagree about which item is which.
  assert.doesNotMatch(block, /^1\. /m);
  assert.match(block, /^2\. /m);
  assert.match(block, /^3\. /m);
});

test("answering only the first few leaves the rest open rather than wrong", async () => {
  const { out, open } = await inABatch(async ({ order }) => {
    const out = await captureStdout(() => gradeManyCommand(client, { answers: `${RIGHT[order[0]]} |` }));
    return { out, open: await openItems() };
  });

  assert.match(out, /^Still open: 2, 3 —/m);
  assert.deepEqual(
    open.map((item) => item.position),
    [2, 3],
  );
});

test("a gap in the list skips that item instead of shifting the rest onto it", async () => {
  const { grades, order } = await inABatch(async ({ order }) => {
    const answers = `${RIGHT[order[0]]} || ${RIGHT[order[2]]}`;
    await captureStdout(() => gradeManyCommand(client, { answers }));
    return { grades: await loadGrades(), order };
  });

  assert.deepEqual(Object.keys(grades).map(Number).sort(), [ASSIGNMENT.get(order[0]), ASSIGNMENT.get(order[2])].sort());
});

test("more answers than open items grades nothing at all", async () => {
  // "|" separates a list here and the halves of one answer in `grade`, so a
  // reply with one too many is ambiguous — and the wrong guess silently marks
  // every item after it against its neighbour's answer key.
  const { out, grades } = await inABatch(async () => {
    const out = await captureStdout(() =>
      gradeManyCommand(client, { answers: "parent | shin | reassuring | kokoroduyoi" }),
    );
    return { out, grades: await loadGrades() };
  });

  assert.match(out, /^! 4 answers for 3 open items — nothing graded\./m);
  assert.deepEqual(grades, {});
});

test("a re-prompted item stays open and takes the next reply on its own", async () => {
  const { first, second, position } = await inABatch(async ({ positionOf }) => {
    // おや is another real reading of 親: a re-prompt, not a miss. Answering it
    // first means everything after it is still open too.
    const padding = "|".repeat(positionOf(11) - 1);
    const first = await captureStdout(() => gradeManyCommand(client, { answers: `${padding}parent, oya` }));
    const second = await captureStdout(() => gradeManyCommand(client, { answers: `${padding}shin` }));
    return { first, second, position: positionOf(11) };
  });

  assert.match(
    first,
    new RegExp(`^${position}\\. 親 That's a real reading, but WaniKani wants the on'yomi here`, "m"),
  );
  assert.match(first, /^Still open: 1, 2, 3 —/m, "a re-prompt leaves the item open");
  assert.match(second, new RegExp(`^${position}\\. 親 ✓$`, "m"), "the bare follow-up answered the reading");
});

test("grading outside a batch says which call is missing", async () => {
  const out = await withTempCacheDir(() =>
    captureStdout(() => gradeManyCommand(client, { answers: "parent, shin" })),
  );

  assert.match(out, /^! No batch on the record — run `queue --limit 10` first/m);
});

test("a fully answered batch points at submit-batch rather than re-asking", async () => {
  const out = await inABatch(async ({ order }) => {
    const answers = order.map((subjectId) => RIGHT[subjectId]).join(" | ");
    await captureStdout(() => gradeManyCommand(client, { answers }));
    return captureStdout(() => promptsCommand(client));
  });

  assert.match(out, /Nothing open — every item in this batch is answered/);
});

test("splitting a reply keeps the halves of an answer together", () => {
  assert.deepEqual(splitReplies("parent, shin | reassuring. kokoroduyoi"), [
    "parent, shin",
    "reassuring. kokoroduyoi",
  ]);
  // A trailing "|" is how people type a list; it isn't a skipped item.
  assert.deepEqual(splitReplies("a | b |"), ["a", "b"]);
  assert.deepEqual(splitReplies("a\nb\n\nc"), ["a", "b", "c"]);
});
