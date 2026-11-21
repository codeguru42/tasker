import type { PlanAnswer } from "../plan/answer.js";
import { formatFindings, type FindingEntry } from "../review/findings-text.js";
import type { Review } from "../store/store.js";

export const REFINE_PROMPT_NAME = "refine";

export const PLAIN_REFINE_CONTEXT = "The user read the plan and asks for a revision.";
export const REOPEN_REFINE_CONTEXT =
  "The user reopened accepted work with feedback. The user needs a new complete plan revision.";

export function openQuestionsText(questions: PlanAnswer["questions"]): string {
  if (questions.length === 0) return "None.";
  return questions.map((q) => `- \`${q.id}\`: ${q.question} (${q.context})`).join("\n");
}

// The verify sentence of a refine context. verifyRun is the number of the passed verify run, if any.
function verifySentence(verifyRun: number | undefined): string {
  return verifyRun === undefined ? "No verify run is recorded." : `Verify run ${verifyRun} passed on that work.`;
}

// The context of a refine that promotes the open findings of a review to a plan. verifyRun is the number of the
// passed verify run of the reviewed work, if any.
export function promotionContextText(
  review: Pick<Review, "number" | "revision">,
  open: readonly FindingEntry[],
  verifyRun: number | undefined,
): string {
  return `Review ${review.number} read the committed work at ${review.revision} and found these open findings. ${verifySentence(verifyRun)} Revise the plan so that the next execute run fixes each open finding. The work that is done stays.\n${formatFindings(open)}`;
}

// The context of a refine from the feedback of the user on the committed work at revision. verifyRun is the
// number of the latest verify run, if any.
export function reviewFeedbackContextText(revision: string, verifyRun: number | undefined): string {
  return `The user read the committed work at ${revision} and asks for a revision of the plan. ${verifySentence(verifyRun)} The work that is done stays. Plan only the work that is still needed on top of it.`;
}

// The context of a refine from a task in failed. origin is the state that the task left when it failed. error is the
// error of the failure, which can have more than one line, so the instruction line goes on its own line.
export function failureContextText(origin: string, error: string): string {
  return `The task failed in ${origin}: ${error}\nThe user gives an instruction for the fix.`;
}
