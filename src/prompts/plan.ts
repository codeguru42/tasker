import type { IssueComment } from "../issues/issue.js";
import { harmlessClosingTags } from "./template.js";

export const PLAN_PROMPT_NAME = "plan";

export function planIssueText(issue: { key: string; title: string; body: string }): string {
  return `Key: ${issue.key}\nTitle: ${issue.title}\nDescription:\n${issue.body}`;
}

// The fill of the template makes </issue-comments> harmless, so this function makes only the closing comment tags harmless.
export function planIssueComments(comments: readonly IssueComment[]): string {
  return comments
    .map((comment, i) => {
      const n = i + 1;
      const author = harmlessClosingTags(comment.author, "comment-text-");
      const created = harmlessClosingTags(comment.created, "comment-text-");
      const body = harmlessClosingTags(comment.body, "comment-text-");
      return `<comment-text-${n}>\n${author} at ${created}:\n${body}\n</comment-text-${n}>`;
    })
    .join("\n");
}
