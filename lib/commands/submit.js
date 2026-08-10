import { srsStageName, srsTierName, srsTierChange } from "../format.js";
import { markSubmitted, countRemainingReviews } from "../reviewQueue.js";

/** Submits a graded review for one assignment. Used by both `wanikani review` and Claude-driven sessions. */
export async function submitCommand(client, { assignmentId, wrongMeaning = 0, wrongReading = 0 }) {
  const review = await client.submitReview({
    assignmentId,
    incorrectMeaningAnswers: wrongMeaning,
    incorrectReadingAnswers: wrongReading,
  });

  const startingSrsStage = review.data.starting_srs_stage;
  const endingSrsStage = review.data.ending_srs_stage;
  await markSubmitted([assignmentId]);

  console.log(
    JSON.stringify(
      {
        assignmentId,
        startingSrsStage,
        endingSrsStage,
        srsStageName: srsStageName(endingSrsStage),
        srsTier: srsTierName(endingSrsStage),
        tierChange: srsTierChange(startingSrsStage, endingSrsStage),
        remaining: await countRemainingReviews(client),
      },
      null,
      2,
    ),
  );
}
