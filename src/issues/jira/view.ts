import type { z } from "zod";
import { isObject } from "../../object.js";
import { type Issue, IssueReadError } from "../issue.js";
import { AcliError, runAcli } from "./run.js";

const NOT_FOUND = "Issue does not exist";

function badView(key: string, reason: string): IssueReadError {
  return new IssueReadError(key, `acli jira workitem view gave bad output for ${key}: ${reason}`);
}

// The error for a view result whose fields do not have the expected form.
export function badViewFields(key: string): IssueReadError {
  return badView(key, "the fields do not match");
}

// Runs `acli jira workitem view` for the named fields and checks the JSON with the schema.
// Each error that this function does not name passes through.
export async function viewWorkitem<T>(
  key: string,
  fields: string,
  schema: z.ZodType<T>,
  env: NodeJS.ProcessEnv,
): Promise<T> {
  let stdout: string;
  try {
    stdout = await runAcli(["jira", "workitem", "view", key, "--json", "--fields", fields], { env });
  } catch (error) {
    if (error instanceof AcliError && error.stderr.includes(NOT_FOUND)) {
      throw new IssueReadError(
        key,
        `the issue ${key} does not exist, or you do not have permission to see it: ${error.stderr.trim()}`,
      );
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw badView(key, "the output is not JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw badViewFields(key);
  return parsed.data;
}

// A status of the category done is closed. Each other status, and a missing status, is open.
export function stateOfStatus(status: unknown): Issue["state"] {
  const category = isObject(status) && isObject(status.statusCategory) ? status.statusCategory : undefined;
  return category?.key === "done" ? "closed" : "open";
}
