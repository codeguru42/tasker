import { formatFindings } from "../review/findings-text.js";
import type { PlanRevision, Review } from "../store/store.js";

export const REVIEW_PROMPT_NAME = "review";

// The line of a plan revision that followed a review.
function revisionLine(revision: PlanRevision): string {
  const head = `Plan revision v${revision.version} (${revision.source}) followed this review`;
  return revision.feedback === null
    ? `${head} with no user feedback.\n`
    : `${head} with this user feedback: ${revision.feedback}\n`;
}

// The text of the earlier reviews for the review prompt, oldest first. Each review shows its findings and then the plan
// revisions that followed it: those made after it ended, up to the start of the next review. All the times are ISO
// strings, so a string compare orders them.
export function earlierReviewsText(reviews: readonly Review[], revisions: readonly PlanRevision[]): string {
  if (reviews.length === 0) return "No earlier review.";
  return reviews
    .map((review, i) => {
      const next = reviews[i + 1];
      const followed = revisions.filter(
        (revision) =>
          revision.createdAt > review.endedAt && (next === undefined || revision.createdAt <= next.startedAt),
      );
      const lines =
        followed.length === 0 ? "No plan revision followed this review.\n" : followed.map(revisionLine).join("");
      return `Review ${review.number}, at ${review.revision}:\n${formatFindings(review.findings)}${lines}`;
    })
    .join("\n");
}
