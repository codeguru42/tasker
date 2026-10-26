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

export async function activeSite(env: NodeJS.ProcessEnv, options: { signal?: AbortSignal } = {}): Promise<string> {
  throw new Error(`not implemented: ${Object.keys(env).length} ${Object.keys(options).length}`);
}

export async function siteGuard(
  repoKey: string,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  throw new Error(
    `not implemented: ${repoKey} ${site ?? ""} ${Object.keys(env).length} ${Object.keys(options).length}`,
  );
}
