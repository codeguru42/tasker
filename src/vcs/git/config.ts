import { z } from "zod";

const nonEmpty = z.string().min(1);

// The schema of vcs.config for the git provider.
export const GitConfigSchema = z.strictObject({
  authorName: nonEmpty.optional().describe("The name that git uses as the author of a commit."),
  authorEmail: nonEmpty.optional().describe("The email that git uses as the author of a commit."),
  sshKey: nonEmpty.optional().describe("The path of the SSH key that git uses."),
});

export type GitVcsConfig = z.output<typeof GitConfigSchema>;
