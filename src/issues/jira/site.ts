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

function foldSite(text: string): string {
  return asciiFold(text.trim());
}

const SITE_PREFIX = "Site:";

// Reads the active site of acli with `acli jira auth status`. The value is trimmed and folded with asciiFold().
// A non-zero exit, no Site line, or an empty value rejects with a JiraLoginError.
// Each other error of runAcli() passes through.
export async function activeSite(env: NodeJS.ProcessEnv, options: { signal?: AbortSignal } = {}): Promise<string> {
  let stdout: string;
  try {
    stdout = await runAcli(["jira", "auth", "status"], { env, signal: options.signal });
  } catch (error) {
    if (error instanceof AcliError) throw new JiraLoginError();
    throw error;
  }
  const line = stdout
    .split(/\r?\n/)
    .map((text) => text.trimStart())
    .find((text) => text.startsWith(SITE_PREFIX));
  const site = line === undefined ? "" : foldSite(line.slice(SITE_PREFIX.length));
  if (site === "") throw new JiraLoginError();
  return site;
}

// Reads the active site on each call and keeps no value. A site of undefined accepts the active site.
// Resolves with the site. A different site rejects with a JiraSiteError.
export async function siteGuard(
  repoKey: string,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const active = await activeSite(env, options);
  if (site === undefined) return active;
  const wanted = foldSite(site);
  if (wanted !== active) throw new JiraSiteError(repoKey, wanted, active);
  return wanted;
}
