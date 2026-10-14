import type { Config, RepoConfig } from "./schema.js";

// Groups the repos of the configuration by the id that idOf() gives, in the order of first use.
// Each list holds the values of doctorRepo() for the repos of that id, in the order of the
// configuration, and it is never empty. A configuration with no repo gives [].
export function reposByProvider<Id, R>(
  config: Config,
  idOf: (repo: RepoConfig) => Id,
  doctorRepo: (key: string, repo: RepoConfig) => R,
): [Id, R[]][] {
  const groups = new Map<Id, R[]>();
  for (const [key, repo] of Object.entries(config.repos)) {
    const id = idOf(repo);
    const group = groups.get(id) ?? [];
    group.push(doctorRepo(key, repo));
    groups.set(id, group);
  }
  return [...groups.entries()];
}
