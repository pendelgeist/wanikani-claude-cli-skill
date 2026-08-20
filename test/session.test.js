import { test } from "node:test";
import assert from "node:assert/strict";
import { askCommand, answerCommand } from "../lib/commands/session.js";
import { loadGrades, openItems } from "../lib/queueOrder.js";
import { follows } from "../lib/commands/grade.js";
import { withTempCacheDir, captureStdout } from "./helpers.js";

/**
 * A whole batch driven the way a session drives it: `ask`, then `answer` with
 * whatever the user typed, and nothing else. No subject ids, no assignment
 * ids, no batch counter, no decision about when to submit — the point of this
 * pair is that none of those reach the driver, so the test refuses to use them
 * too. It answers by reading the printed prompt, exactly as a person would.
 */

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

const VOCAB = {
  id: 4,
  object: "vocabulary",
  data: {
    level: 3,
    characters: "心強い",
    document_url: "https://www.wanikani.com/vocabulary/心強い",
    meanings: [{ meaning: "Reassuring", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    readings: [{ primary: true, accepted_answer: true, reading: "こころづよい" }],
  },
};

const RADICAL = {
  id: 5,
  object: "radical",
  data: {
    level: 1,
    characters: "亅",
    document_url: "https://www.wanikani.com/radicals/hook",
    meanings: [{ meaning: "Hook", primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
  },
};

const SUBJECTS = [KANJI, VOCAB, RADICAL];
const RIGHT = { 親: "parent, shin", 心強い: "reassuring, kokoroduyoi", 亅: "hook" };

function fakeClient() {
  const client = {
    submitted: [],
    async getAssignments() {
      return SUBJECTS.map((subject, index) => ({ id: 100 + index, data: { subject_id: subject.id } }));
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, SUBJECTS.find((s) => s.id === id)]).filter(([, s]) => s));
    },
    async submitReview(review) {
      client.submitted.push(review);
      return { data: { starting_srs_stage: 4, ending_srs_stage: 5 } };
    },
  };
  return client;
}

const ask = (client) => captureStdout(() => askCommand(client, { limit: 3 }));
const answer = (client, reply) => captureStdout(() => answerCommand(client, { reply }));

/**
 * Runs `fn` with the queue's Fisher-Yates shuffle pinned to a no-op, so a
 * test can say which item landed at position one. Everything else here reads
 * the printed prompt instead, which is what a person does — but a bug that
 * only shows up at one position needs that position.
 */
async function withShuffleThatKeepsOrder(fn) {
  const random = Math.random;
  Math.random = () => 0.999999;
  try {
    return await fn();
  } finally {
    Math.random = random;
  }
}

/** The glyph in a printed prompt — how a person knows what they're answering. */
const glyphOf = (output) => Object.keys(RIGHT).find((characters) => output.includes(characters));

test("ask starts a batch and prints the question, and answer needs no id to grade it", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const opening = await ask(client);
    assert.match(opening, /Meaning and reading together on one line/, "the convention, once");
    const glyph = glyphOf(opening);
    assert.ok(glyph, `a question with an item in it, got: ${opening}`);
    assert.match(opening, new RegExp(`^1\\. ${glyph}$`, "m"), "numbered, and nothing else on the line");

    const verdict = await answer(client, RIGHT[glyph]);
    assert.match(verdict, /^✓$/m);
    assert.match(verdict, /^2\. /m, "the next question comes with the verdict");
  });
});

test("answer grades against whatever is open, in the order the batch was served", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    const asked = [];
    for (let position = 1; position <= 3; position += 1) {
      const glyph = glyphOf(output);
      asked.push(glyph);
      output = await answer(client, RIGHT[glyph]);
    }

    assert.equal(new Set(asked).size, 3, "each item asked once, none repeated");
    assert.equal(Object.keys(await loadGrades()).length, 3, "and all three on the record");
  });
});

test("a finished batch is submitted by the next ask, with nobody deciding to", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    for (let position = 1; position <= 3; position += 1) {
      output = await answer(client, RIGHT[glyphOf(output)]);
    }

    // Not on the last answer: a miss there has to stay overrulable, and
    // `--forgive` can't reach a verdict that has already gone to the API.
    assert.match(output, /that's the batch/);
    assert.equal(client.submitted.length, 0, "nothing has gone to the API yet");

    // Deciding *when* to submit is the decision this removes: one sitting
    // answered thirty items across three batches and submitted none of them.
    const summary = await ask(client);
    assert.match(summary, /3 done, 3 perfect/);
    assert.equal(client.submitted.length, 3);
    assert.deepEqual(await loadGrades(), {}, "and the record is spent, not left to double up");
  });
});

test("the last item of a batch can still be forgiven, because the batch hasn't gone yet", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    for (let position = 1; position <= 2; position += 1) {
      output = await answer(client, RIGHT[glyphOf(output)]);
    }
    // Miss the tenth item — the case an auto-submit on the last answer would
    // have made permanent between one call and the next.
    const missed = await answer(client, "wrong answer entirely");
    assert.match(missed, /^✗ /m);

    await captureStdout(() => answerCommand(client, { forgive: "meaning" }));
    await ask(client);

    assert.equal(client.submitted.length, 3);
    assert.ok(
      client.submitted.every((review) => review.incorrectMeaningAnswers === 0),
      "forgiven before it went, not argued about afterwards",
    );
  });
});

test("a re-prompt leaves the item open, and the next answer lands on the same item", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    // Walk to 親 whatever position the shuffle gave it, answering the rest right.
    let output = await ask(client);
    while (glyphOf(output) !== "親") output = await answer(client, RIGHT[glyphOf(output)]);

    // おや is a real reading of 親 — the website shakes and asks again.
    const nudged = await answer(client, "parent, oya");
    assert.match(nudged, /on'yomi/, "it names the type it wants");
    assert.doesNotMatch(nudged, /しん/, "and not the reading itself — the item is still live");
    assert.match(nudged, /same item — still their turn/);

    const open = await openItems();
    assert.equal(open[0].subjectId, 3, "still first in line");
    assert.equal(open[0].awaiting, "reading");

    // A bare reading, the natural thing to type next, graded against 親.
    const closed = await answer(client, "shin");
    assert.match(closed, /^✓$/m);
  });
});

test("ask re-asks the open item rather than serving a new one", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const opening = await ask(client);
    const glyph = glyphOf(opening);

    const again = await ask(client);
    assert.match(again, new RegExp(`^1\\. ${glyph}$`, "m"), "the same question, at the same number");
    assert.doesNotMatch(again, /Meaning and reading together/, "the convention is said once a sitting");
  });
});

test("ask says a mid-question item is waiting on its reading, not on a fresh answer", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    while (glyphOf(output) !== "親") output = await answer(client, RIGHT[glyphOf(output)]);
    await answer(client, "parent, oya");

    const waiting = await ask(client);
    assert.match(waiting, /親/);
    assert.match(waiting, /^Reading\?$/m, "a prompt alone would be answered with a meaning again");
  });
});

test("answer refuses rather than grading into nothing when no batch has been asked", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const output = await answer(client, "parent, shin");
    assert.match(output, /^! No batch on record/);
    assert.match(output, /`ask`/, "it names the call that fixes it");
    assert.deepEqual(await loadGrades(), {}, "and nothing was recorded");
  });
});

test("--forgive takes back the item just graded, without being told which", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    let output = await ask(client);
    while (glyphOf(output) !== "心強い")
      output = await answer(client, RIGHT[glyphOf(output)]);

    const missed = await answer(client, "encouraging, kokoroduyoi");
    assert.match(missed, /^✗ /m);

    const forgiven = await captureStdout(() => answerCommand(client, { forgive: "meaning" }));
    assert.match(forgiven, /forgiven \(meaning\)/);

    const grades = Object.values(await loadGrades());
    assert.ok(
      grades.every((grade) => grade.wrongMeaning === 0),
      "the miss came back off the record, not just out of the chat",
    );
  });
});

test("nothing the driver has to hold appears in what ask and answer print", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();

    const opening = await ask(client);
    const verdict = await answer(client, RIGHT[glyphOf(opening)]);

    for (const output of [opening, verdict]) {
      assert.doesNotMatch(
        output,
        /subjectId|assignmentId/,
        "an id here is an id to pass back wrong",
      );
      assert.doesNotMatch(
        output,
        /^\s*[[{]/m,
        "no JSON to read a question out of",
      );
    }
  });
});

test("a glyph-less radical arrives as its image URL, through ask and through answer", async () => {
  const IMAGED = {
    id: 9,
    object: "radical",
    data: {
      level: 1,
      characters: null,
      character_images: [{ content_type: "image/png", url: "https://files.wanikani.com/w2i6pg4t17" }],
      document_url: "https://www.wanikani.com/radicals/rib-cage",
      meanings: [{ meaning: "Rib Cage", primary: true, accepted_answer: true }],
      auxiliary_meanings: [],
    },
  };
  const client = {
    async getAssignments() {
      return [{ id: 200, data: { subject_id: 9 } }];
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, id === 9 ? IMAGED : null]).filter(([, s]) => s));
    },
  };

  await withTempCacheDir(async () => {
    // Naming it ("Rib Cage image", "5. Radical") is naming the answer, and a
    // sitting that did the second had the user miss a picture they never saw.
    const opening = await captureStdout(() => askCommand(client, { limit: 1 }));
    assert.match(opening, /^1\. https:\/\/files\.wanikani\.com\/w2i6pg4t17$/m);
    assert.doesNotMatch(opening, /rib.?cage/i);
  });
});

test("ask says so when nothing is due, rather than serving an empty batch", async () => {
  const client = { async getAssignments() { return []; }, async getSubjectsByIds() { return new Map(); } };

  await withTempCacheDir(async () => {
    const output = await captureStdout(() => askCommand(client, { limit: 10 }));
    assert.match(output, /Nothing due right now/);
  });
});

test("the driver note stays off the session's screen", async () => {
  await withTempCacheDir(async () => {
    // It's addressed to whoever is driving, not to the person answering, and
    // anything on stdout is liable to be read back out to them.
    const opening = await ask(fakeClient());
    assert.doesNotMatch(opening, /Driving:/);
    assert.doesNotMatch(opening, /`answer "<their whole reply>"`/);
  });
});

test("a verdict that graded nothing doesn't pull the next question up under it", () => {
  // `answer` and `grade` share this, so the batch can't advance past an item
  // whose answer went nowhere — printing a prompt under a `NOT RECORDED`
  // warning sweeps the warning off the screen with it.
  assert.equal(follows({ assignmentId: 1 }), true);
  assert.equal(follows({ assignmentId: 1, open: true }), false, "the item is still theirs");
  assert.equal(follows({ assignmentId: 1, error: "no subject" }), false);
  assert.equal(follows({ assignmentId: 1, alreadyAnswered: {} }), false);
  assert.equal(follows({ assignmentId: null }), false, "nothing was recorded, so nothing follows");
});

test("an item that can't be shown is stepped over, not silently graded against", async () => {
  // No glyph and no image, so it has no prompt. `ask` and `answer` used to
  // pick the open item separately: `ask` printed an error for this one and
  // `answer` graded the user's reply against it anyway — a miss on an item
  // they were never shown.
  const UNSHOWABLE = {
    id: 7,
    object: "radical",
    data: {
      level: 1,
      characters: null,
      character_images: [],
      document_url: "https://www.wanikani.com/radicals/ghost",
      meanings: [{ meaning: "Ghost", primary: true, accepted_answer: true }],
      auxiliary_meanings: [],
    },
  };
  const pair = [UNSHOWABLE, KANJI];
  const client = {
    async getAssignments() {
      return pair.map((subject, index) => ({ id: 300 + index, data: { subject_id: subject.id } }));
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, pair.find((s) => s.id === id)]).filter(([, s]) => s));
    },
  };

  await withTempCacheDir(async () => {
    // Pinned, because this is exactly the case a shuffle hides: with the
    // unshowable item at position one, `ask` used to print a literal "null"
    // and CI passed or failed on the coin toss.
    const opening = await withShuffleThatKeepsOrder(() => captureStdout(() => askCommand(client, { limit: 2 })));
    assert.match(opening, /^2\. 親$/m, "it steps over position one and asks the item it can show");
    assert.doesNotMatch(opening, /null/, "a prompt that can't be built is not a prompt to print");
    assert.doesNotMatch(opening, /Ghost/, "and the one with nothing to show is not described");

    await captureStdout(() => answerCommand(client, { reply: "parent, shin" }));

    const graded = Object.entries(await loadGrades());
    assert.equal(graded.length, 1, "one answer, one grade");
    const open = await openItems();
    assert.deepEqual(
      open.map((item) => item.subjectId),
      [7],
      "the unshowable item is still open — nobody could answer it, so nobody did",
    );
  });
});

test("a batch of nothing but unshowable items says so instead of wedging", async () => {
  const GHOST = {
    id: 7,
    object: "radical",
    data: { level: 1, characters: null, character_images: [], document_url: "u", meanings: [], auxiliary_meanings: [] },
  };
  const client = {
    async getAssignments() {
      return [{ id: 400, data: { subject_id: 7 } }];
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, GHOST]));
    },
  };

  await withTempCacheDir(async () => {
    // Said on the *first* ask, not after a wasted one: serving a batch and
    // finding nothing in it that can be shown is one answer, not two.
    const stuck = await captureStdout(() => askCommand(client, { limit: 1 }));
    assert.match(stuck, /no way to show/);
    assert.doesNotMatch(stuck, /null/);
    assert.match(stuck, /they stay due/, "the items aren't lost, they just can't be asked here");

    const output = await captureStdout(() => answerCommand(client, { reply: "ghost" }));
    assert.match(output, /Nothing was graded/);
    assert.deepEqual(await loadGrades(), {}, "and nothing was");
  });
});

test("ask serves a batch of ten when nobody says otherwise", async () => {
  // `queue` took whatever it was given and the old flow always said
  // `--limit 10`. `ask` replaced that call without carrying the number over,
  // and one sitting was served all 67 due reviews as a single batch: ten
  // answers stranded behind fifty-seven unasked ones, unsendable until every
  // last one was done, and due to expire with the sitting.
  const many = Array.from({ length: 25 }, (_, index) => ({
    id: 500 + index,
    object: "kanji",
    data: {
      level: 1,
      characters: `字${index}`,
      document_url: "u",
      meanings: [{ meaning: `M${index}`, primary: true, accepted_answer: true }],
      auxiliary_meanings: [],
      readings: [{ type: "onyomi", primary: true, accepted_answer: true, reading: "しん" }],
    },
  }));
  const client = {
    async getAssignments() {
      return many.map((subject, index) => ({ id: 600 + index, data: { subject_id: subject.id } }));
    },
    async getSubjectsByIds(ids) {
      return new Map(ids.map((id) => [id, many.find((s) => s.id === id)]).filter(([, s]) => s));
    },
  };

  await withTempCacheDir(async () => {
    await captureStdout(() => askCommand(client));
    assert.equal((await openItems()).length, 10, "ten, not everything that happens to be due");
  });
});

test("a question about an item isn't graded as an answer to it", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    const opening = await ask(client);
    const glyph = glyphOf(opening);

    // "tip 育" went in verbatim — exactly as the hand-over rule says — and 育
    // went down as a miss on both halves because the user wanted a hint.
    const refused = await answer(client, `tip ${glyph}`);

    assert.match(refused, /^! That reads as a question/m);
    assert.match(refused, new RegExp(`explain ${glyph}`), "and points at the command that answers it");
    assert.deepEqual(await loadGrades(), {}, "nothing recorded");
    assert.equal((await openItems())[0].position, 1, "and the item is still waiting");
  });
});

test("the question it names is the one they asked about, not the one that's open", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    const opening = await ask(client);
    const open = glyphOf(opening);

    // Mid-batch on one item, asking about another: 場 is what they want
    // explained, whatever is on screen.
    const refused = await answer(client, "explain 場");

    assert.match(refused, /`explain 場`/);
    assert.match(refused, new RegExp(`${open} is still open`));
  });
});

test("kana answers are untouched, since a reading is kana by definition", async () => {
  await withTempCacheDir(async () => {
    const client = fakeClient();
    let output = await ask(client);
    while (glyphOf(output) !== "心強い") output = await answer(client, RIGHT[glyphOf(output)]);

    // こころづよい is an answer, not a question — only Han script is the tell.
    const graded = await answer(client, "reassuring こころづよい");
    assert.match(graded, /^✓$/m);
  });
});
