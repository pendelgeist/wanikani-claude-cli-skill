import { srsStageName } from "../format.js";

/** Submits a graded review for one assignment. Used by both `wanikani review` and Claude-driven sessions. */
export async function submitCommand(client, { assignmentId, wrongMeaning = 0, wrongReading = 0 }) {
  const review = await client.submitReview({
    assignmentId,
    incorrectMeaningAnswers: wrongMeaning,
    incorrectReadingAnswers: wrongReading,
  });

  console.log(
    JSON.stringify(
      {
        assignmentId,
        endingSrsStage: review.data.ending_srs_stage,
        srsStageName: srsStageName(review.data.ending_srs_stage),
      },
      null,
      2,
    ),
  );
}
