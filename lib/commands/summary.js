import { formatRelativeToNow } from "../format.js";

// The /summary endpoint reports what's available now *and* what unlocks over
// the next 24 hours, bucketed by the hour. Only the buckets whose
// available_at has already passed are actually due — summing the lot reports
// tomorrow's reviews as if they were waiting right now.
function subjectsAvailableBy(buckets, at) {
  return (buckets ?? [])
    .filter((bucket) => !bucket.available_at || new Date(bucket.available_at).getTime() <= at)
    .reduce((total, bucket) => total + bucket.subject_ids.length, 0);
}

function subjectsTotal(buckets) {
  return (buckets ?? []).reduce((total, bucket) => total + bucket.subject_ids.length, 0);
}

export async function summaryCommand(client, { json = false } = {}) {
  const [user, summary] = await Promise.all([client.getUser(), client.getSummary()]);

  const now = Date.now();
  const lessonCount = subjectsAvailableBy(summary.data.lessons, now);
  const reviewCount = subjectsAvailableBy(summary.data.reviews, now);
  const upcomingReviews = subjectsTotal(summary.data.reviews) - reviewCount;
  const nextReviewsAt = summary.data.next_reviews_at;

  if (json) {
    console.log(
      JSON.stringify(
        {
          level: user.data.level,
          username: user.data.username,
          lessonsAvailable: lessonCount,
          reviewsAvailable: reviewCount,
          reviewsUpcoming24h: upcomingReviews,
          nextReviewsAt,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`${user.data.username} — Level ${user.data.level}`);
  // The count still comes from the API and is worth knowing; doing them isn't
  // something this tool offers, so the line says where they get done rather
  // than leaving someone to ask for a command that was deliberately removed.
  console.log(
    lessonCount > 0
      ? `Lessons available: ${lessonCount} — do those on wanikani.com; this does reviews only.`
      : "Lessons available: 0",
  );
  console.log(`Reviews available: ${reviewCount}`);
  if (upcomingReviews > 0) {
    console.log(`Coming in the next 24h: ${upcomingReviews}`);
  }
  if (reviewCount === 0 && nextReviewsAt) {
    console.log(`Next reviews in: ${formatRelativeToNow(nextReviewsAt)}`);
  }

  if (user.data.subscription?.active === false && user.data.subscription.type === "free") {
    console.log(
      `\n(Free account — content above level ${user.data.subscription.max_level_granted} is locked.)`,
    );
  }
}
