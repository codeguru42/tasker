import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, parse } from "node:path";
import { GitError, runGit } from "./run.js";
import { runRemoteGit } from "./ssh.js";

// The same structure as the output of GitConfigSchema, so a caller passes repo.vcs.config.
export interface GitVcsConfig {
  authorName?: string;
  authorEmail?: string;
  sshKey?: string;
}

export interface ProvisionOptions {
  remote: string;
  clone: string;
  config: GitVcsConfig;
  env: NodeJS.ProcessEnv;
}

// Makes the bare clone of the remote at options.clone and fetches all branches as origin/*.
// The marker file <clone>.incomplete exists while a fresh clone is not complete.
export async function provisionClone(options: ProvisionOptions): Promise<void> {
  const { remote, clone, config, env } = options;
  const marker = `${clone}.incomplete`;
  const root = parse(process.cwd()).root;

  // The error text can hold git output, so the new error sets no cause.
  const failure = await runRemoteGit(
    ["ls-remote", "--exit-code", "--", remote],
    { cwd: root, env },
    config.sshKey,
  ).then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof GitError) {
        return error;
      }
      throw error;
    },
  );
  if (failure?.exitCode === 2) {
    throw new Error(`the remote has no refs: ${remote}`);
  }
  if (failure !== undefined) {
    const detail = failure.stderr.trim();
    throw new Error(`the remote does not answer: ${remote}${detail === "" ? "" : `: ${detail}`}`);
  }

  mkdirSync(dirname(clone), { recursive: true });
  writeFileSync(marker, "");
  await runRemoteGit(
    ["clone", "--bare", "--", remote, clone],
    { cwd: dirname(clone), env },
    config.sshKey,
  );
  await runGit(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], {
    gitDir: clone,
    env,
  });
  await runRemoteGit(["fetch", "--prune", "origin"], { gitDir: clone, env }, config.sshKey);
  rmSync(marker, { force: true });
}
