import { z } from "zod";

const nonEmpty = z.string().min(1);

// The schema of vcs.config for the git provider.
export const GitConfigSchema = z.strictObject({
  authorName: nonEmpty.optional(),
  authorEmail: nonEmpty.optional(),
  sshKey: nonEmpty.optional(),
});

export type GitVcsConfig = z.output<typeof GitConfigSchema>;
