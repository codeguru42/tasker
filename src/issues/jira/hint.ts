import { BaseHintError, type Issue } from "../issue.js";

// The base branch field of a Jira issue holds a value that is not a string.
export class BaseBranchFieldError extends BaseHintError {
  readonly fieldId: string;

  constructor(fieldId: string, message: string) {
    super([], message);
    this.name = "BaseBranchFieldError";
    this.fieldId = fieldId;
  }
}

// Gives the base branch hint of a Jira issue from its base branch field. It makes no call.
// No field, a missing key, null, an empty string and a string of white space only give undefined.
// Each other string is the hint as it is, with no trim and no strip. Each other value throws a BaseBranchFieldError.
export function jiraBaseBranchHint(issue: Issue): string | undefined {
  const field = issue.baseBranchField;
  if (field?.value === undefined || field.value === null) return undefined;
  if (typeof field.value !== "string") {
    throw new BaseBranchFieldError(
      field.id,
      `the base branch field ${field.id} of the issue ${issue.ref.key} is not a string: ${JSON.stringify(field.value)}`,
    );
  }
  return field.value.trim() === "" ? undefined : field.value;
}
