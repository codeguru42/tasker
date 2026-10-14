import type { PlanAnswer } from "../plan/answer.js";

export function openQuestionsText(questions: PlanAnswer["questions"]): string {
  if (questions.length === 0) return "None.";
  return questions.map((q) => `- \`${q.id}\`: ${q.question} (${q.context})`).join("\n");
}
