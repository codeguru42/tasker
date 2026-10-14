import type { z } from "zod";

export function formatIssues(issues: readonly z.core.$ZodIssue[], root: string): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        lines.push(`${[...issue.path, key].join(".")}: unrecognized key`);
      }
      continue;
    }
    const path = issue.path.join(".") || root;
    lines.push(`${path}: ${issue.message}`);
  }
  return lines;
}
