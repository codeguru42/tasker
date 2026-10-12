import type { VcsProviderId } from "../config/schema.js";
import { GitConfigSchema } from "./git/config.js";

// The strict schema of vcs.config for a provider id. Each provider owns the schema of its config.
export function vcsConfigSchema(provider: VcsProviderId) {
  switch (provider) {
    case "git":
      return GitConfigSchema;
  }
}
