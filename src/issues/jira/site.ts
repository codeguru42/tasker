import { asciiFold } from "../../ascii-fold.js";
import { AcliError, runAcli } from "./run.js";

// The Jira login is missing: acli has no active site.
export class JiraLoginError extends Error {
  constructor() {
    super("acli has no Jira login. Run `acli jira auth login`.");
    this.name = "JiraLoginError";
  }
}

// The site of the repo differs from the active site of acli.
export class JiraSiteError extends Error {
  readonly repoKey: string;
  readonly site: string;
  readonly activeSite: string;

  constructor(repoKey: string, site: string, activeSite: string) {
    super(
      `Jira repo '${repoKey}' names the site ${site}, but acli uses ${activeSite}. Switch acli with \`acli jira auth switch --site ${site}\`, then run the command again.`,
    );
    this.name = "JiraSiteError";
    this.repoKey = repoKey;
    this.site = site;
    this.activeSite = activeSite;
  }
}

export function foldSite(text: string): string {
  return asciiFold(text.trim());
}

const SITE_PREFIX = "Site:";
const EMAIL_PREFIX = "Email:";

// The active login of acli: the site and the email of the account.
export interface JiraLogin {
  site: string;
  email: string | undefined;
}

// Reads the active login of acli with one `acli jira auth status` call.
// The site is trimmed and folded with asciiFold(). A non-zero exit, no Site line, or an empty site rejects with a
// JiraLoginError. The email is the trimmed value of the first Email line. No such line, or an empty value, gives
// undefined. Each other error of runAcli() passes through.
export async function readLogin(env: NodeJS.ProcessEnv, options: { signal?: AbortSignal } = {}): Promise<JiraLogin> {
  let stdout: string;
  try {
    stdout = await runAcli(["jira", "auth", "status"], { env, signal: options.signal });
  } catch (error) {
    if (error instanceof AcliError) throw new JiraLoginError();
    throw error;
  }
  const lines = stdout.split(/\r?\n/).map((text) => text.trimStart());
  const siteLine = lines.find((text) => text.startsWith(SITE_PREFIX));
  const site = siteLine === undefined ? "" : foldSite(siteLine.slice(SITE_PREFIX.length));
  if (site === "") throw new JiraLoginError();
  const emailLine = lines.find((text) => text.startsWith(EMAIL_PREFIX));
  const email = emailLine === undefined ? "" : emailLine.slice(EMAIL_PREFIX.length).trim();
  return { site, email: email === "" ? undefined : email };
}

// Reads the active site of acli. See readLogin().
export async function activeSite(env: NodeJS.ProcessEnv, options: { signal?: AbortSignal } = {}): Promise<string> {
  return (await readLogin(env, options)).site;
}

// Reads the active login on each call and keeps no value. A site of undefined accepts the active site.
// Resolves with the login, whose site is the wanted or the active site. A different site rejects with a JiraSiteError.
export async function guardedLogin(
  repoKey: string,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal } = {},
): Promise<JiraLogin> {
  const active = await readLogin(env, options);
  if (site === undefined) return active;
  const wanted = foldSite(site);
  if (wanted !== active.site) throw new JiraSiteError(repoKey, wanted, active.site);
  return { site: wanted, email: active.email };
}

// Reads the active site on each call. See guardedLogin().
export async function siteGuard(
  repoKey: string,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  return (await guardedLogin(repoKey, site, env, options)).site;
}
