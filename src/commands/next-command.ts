import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { executeIssue } from "./execute.js";
import { planIssue } from "./plan.js";
import { refineIssue } from "./refine.js";
import { reviewFeedbackIssue, reviewIssue } from "./review.js";
import { startIssue } from "./start.js";
import { verifyIssue } from "./verify.js";

// The command that runs after the move of tasker retry or tasker resume. The refine commands need the feedback.
export type NextRun =
  | { command: "start" | "plan" | "execute" | "verify" | "review" }
  | { command: "refine"; feedback: string | undefined }
  | { command: "review-feedback"; feedback: string };

// Runs the command of next for the issue, with the steps and the output of that command.
export async function runNextCommand(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string },
  next: NextRun,
): Promise<void> {
  switch (next.command) {
    case "start":
      await startIssue(io, config, issue, options);
      break;
    case "plan":
      await planIssue(io, config, issue, options);
      break;
    case "refine":
      await refineIssue(io, config, issue, options, next.feedback);
      break;
    case "review-feedback":
      await reviewFeedbackIssue(io, config, issue, options, next.feedback);
      break;
    case "execute":
      await executeIssue(io, config, issue, options);
      break;
    case "verify":
      await verifyIssue(io, config, issue, options);
      break;
    case "review":
      await reviewIssue(io, config, issue, options);
      break;
  }
}
