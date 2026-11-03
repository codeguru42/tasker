import { badRestOutput, jiraGet, type JiraCredentials } from "./rest.js";

// No field, or more than one field, of the issue has the wanted name.
export class JiraFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraFieldError";
  }
}

// Looks up the id of the field with the name `fieldName` with GET /rest/api/3/issue/<key>?expand=names.
// The name must be equal, with the same case. No match, or more than one, rejects with a JiraFieldError.
// A bad reply rejects with a JiraRestError.
export async function lookupFieldId(
  issueKey: string,
  site: string,
  fieldName: string,
  credentials: JiraCredentials,
  options: { fetch: typeof fetch; signal?: AbortSignal },
): Promise<string> {
  const what = `the issue ${issueKey}`;
  const reply = await jiraGet(site, `/rest/api/3/issue/${encodeURIComponent(issueKey)}?expand=names`, credentials, {
    ...options,
    what,
  });
  const names = (reply as { names?: unknown } | null)?.names;
  if (typeof names !== "object" || names === null || Array.isArray(names)) {
    throw badRestOutput(what, site);
  }
  const ids = Object.entries(names)
    .filter(([, name]) => name === fieldName)
    .map(([id]) => id);
  if (ids.length === 0) throw new JiraFieldError(`the issue ${issueKey} has no field with the name "${fieldName}"`);
  if (ids.length > 1) {
    throw new JiraFieldError(
      `the issue ${issueKey} has more than one field with the name "${fieldName}": ${ids.join(", ")}`,
    );
  }
  return ids[0];
}
