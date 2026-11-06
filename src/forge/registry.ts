import type { Config } from "../config/schema.js";
import { createGitHubForge } from "./github/provider.js";
import type { ForgeProvider } from "./provider.js";

const providers: Record<string, (account: string) => ForgeProvider> = {
  github: createGitHubForge,
};

export function forgeForRepo(config: Config, repoKey: string): ForgeProvider {
  if (!Object.hasOwn(config.repos, repoKey)) {
    throw new Error(`unknown repo "${repoKey}": no repo with this key is in the configuration`);
  }

  const forge = config.repos[repoKey]?.forge;
  if (forge === undefined) {
    throw new Error(`repo "${repoKey}" has no forge configuration at repos.${repoKey}.forge`);
  }
  if (!Object.hasOwn(providers, forge.provider)) {
    throw new Error(`unknown forge provider "${forge.provider}" for repo "${repoKey}"`);
  }

  return providers[forge.provider](forge.account);
}
