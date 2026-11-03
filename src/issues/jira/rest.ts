import { isSet } from "../../config/path.js";

export interface JiraCredentials {
  email: string;
  token: string;
}

export interface JiraCredentialSettings {
  apiToken?: string;
  email?: string;
}

// No token or no email for a REST call. `missing` says which one. The message names the variable and the key, never a value.
export class JiraCredentialError extends Error {
  readonly missing: "token" | "email";

  constructor(missing: "token" | "email", message: string) {
    super(message);
    this.missing = missing;
    this.name = "JiraCredentialError";
  }
}

// A REST call failed. `status` is the HTTP status, or undefined when no answer came.
// The message holds the site and what the call was for, never the reply body or a credential.
export class JiraRestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status: number | undefined) {
    super(message);
    this.name = "JiraRestError";
    this.status = status;
  }
}

// Gives the token and the email of a REST call. Reads only the env that the caller passes.
// A variable that is empty or has only white space counts as not set, by the rule of isSet().
// The token: TASKER_JIRA_TOKEN, then the apiToken key. The email: TASKER_JIRA_EMAIL, then the email key, then the
// email of acli.
export function jiraCredentials(
  settings: JiraCredentialSettings,
  env: NodeJS.ProcessEnv,
  acliEmail: string | undefined,
): JiraCredentials {
  const token = isSet(env.TASKER_JIRA_TOKEN) ? env.TASKER_JIRA_TOKEN : settings.apiToken;
  if (token === undefined) {
    throw new JiraCredentialError("token", "no Jira API token: set TASKER_JIRA_TOKEN or issueTracker.apiToken");
  }
  const email = isSet(env.TASKER_JIRA_EMAIL) ? env.TASKER_JIRA_EMAIL : (settings.email ?? acliEmail);
  if (email === undefined) {
    throw new JiraCredentialError("email", "no Jira email: set TASKER_JIRA_EMAIL or issueTracker.email");
  }
  return { email, token };
}

function restCallPrefix(what: string, site: string): string {
  return `the Jira REST call for ${what} on ${site}`;
}

// The error of a REST reply that does not have the expected form. The one home of this text: jiraGet() and the
// callers of jiraGet() use it.
export function badRestOutput(what: string, site: string): JiraRestError {
  return new JiraRestError(`${restCallPrefix(what, site)} gave bad output`, undefined);
}

// True when jiraGet() throws the error as it is: an AbortError, or any error after the signal aborts.
function passesThrough(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

// Calls GET https://<site><path> with basic auth and gives the parsed JSON body.
// A status that is not 2xx, a failed call and a body that is not JSON reject with a JiraRestError.
// An AbortError, and each error after the signal aborts, for example a TimeoutError of AbortSignal.timeout(), pass
// through as they are.
export async function jiraGet(
  site: string,
  path: string,
  credentials: JiraCredentials,
  options: { fetch: typeof fetch; what: string; signal?: AbortSignal },
): Promise<unknown> {
  const prefix = restCallPrefix(options.what, site);
  const basic = Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64");
  let response: Response;
  try {
    response = await options.fetch(`https://${site}${path}`, {
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
      signal: options.signal,
    });
  } catch (error) {
    if (passesThrough(error, options.signal)) throw error;
    throw new JiraRestError(`${prefix} got no answer`, undefined);
  }
  if (!response.ok) throw new JiraRestError(`${prefix} failed with HTTP ${response.status}`, response.status);
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    if (passesThrough(error, options.signal)) throw error;
    throw badRestOutput(options.what, site);
  }
}
