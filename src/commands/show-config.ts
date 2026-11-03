import type { RegisterCommand } from "../cli.js";
import type { RepoConfig } from "../config/schema.js";
import { loadConfigOrFail, repoKeyOrFail } from "./shared.js";

const MASK = "***";

function maskTracker<T extends { apiToken?: string; email?: string }>(tracker: T): T {
  return {
    ...tracker,
    ...(tracker.apiToken === undefined ? {} : { apiToken: MASK }),
    ...(tracker.email === undefined ? {} : { email: MASK }),
  };
}

function maskRepo(repo: RepoConfig): RepoConfig {
  return { ...repo, issueTracker: maskTracker(repo.issueTracker) };
}

export const showConfig: RegisterCommand = (program, io) => {
  program
    .command("show-config")
    .description("Print the configuration as JSON, with the defaults filled in")
    .option("--repo <key>", "Print only the repo with this key")
    .action((options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const key = options.repo;
      if (key === undefined) {
        const masked = {
          ...config,
          trackers: Object.fromEntries(Object.entries(config.trackers).map(([name, t]) => [name, maskTracker(t)])),
          repos: Object.fromEntries(Object.entries(config.repos).map(([name, r]) => [name, maskRepo(r)])),
        };
        io.stdout(`${JSON.stringify(masked, null, 2)}\n`);
        return;
      }
      repoKeyOrFail(io, config, key);
      io.stdout(`${JSON.stringify(maskRepo(config.repos[key]), null, 2)}\n`);
    });
};
