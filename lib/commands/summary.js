import { formatRelativeToNow } from "../format.js";

export async function summaryCommand(client, { json = false } = {}) {
  const [user, summary] = await Promise.all([client.getUser(), client.getSummary()]);

  const lessonCount = summary.data.lessons.reduce((n, l) => n + l.subject_ids.length, 0);
  const reviewCount = summary.data.reviews.reduce((n, r) => n + r.subject_ids.length, 0);
  const nextReviewsAt = summary.data.next_reviews_at;

  if (json) {
    console.log(
      JSON.stringify(
        {
          level: user.data.level,
          username: user.data.username,
          lessonsAvailable: lessonCount,
          reviewsAvailable: reviewCount,
          nextReviewsAt,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`${user.data.username} — Level ${user.data.level}`);
  console.log(`Lessons available: ${lessonCount}`);
  console.log(`Reviews available: ${reviewCount}`);
  if (reviewCount === 0 && nextReviewsAt) {
    console.log(`Next reviews in: ${formatRelativeToNow(nextReviewsAt)}`);
  }

  if (!user.data.subscription.active && user.data.subscription.type === "free") {
    console.log(
      `\n(Free account — content above level ${user.data.subscription.max_level_granted} is locked.)`,
    );
  }
}
