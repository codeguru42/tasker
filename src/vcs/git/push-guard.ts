import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { replaceFile } from "../../replace-file.js";
import type { GitLocation } from "./run.js";
import { runRemoteGit, shellQuote } from "./ssh.js";

// The pre-push hook. It accepts a push that has a valid token and deletes the token file.
function hookScript(publishTokens: string): string {
  return [
    "#!/bin/sh",
    "# tasker writes this file on each provision. It rejects each push without a valid publish token.",
    `tokens=${shellQuote(resolve(publishTokens))}`,
    "token=$TASKER_PUBLISH_TOKEN",
    "case $token in",
    "  *[!0-9a-f]*) token= ;;",
    "esac",
    'if [ ${#token} -eq 64 ] && rm -- "$tokens/$token" 2>/dev/null; then',
    "  exit 0",
    "fi",
    'echo "tasker: the push has no valid publish token" >&2',
    "exit 1",
    "",
  ].join("\n");
}

// Writes <clone>/hooks/pre-push through a temp file and a rename, with mode 0755.
// A failed write throws an error with the fs error as its cause.
export function installPushHook(clone: string, publishTokens: string): void {
  const hooks = join(clone, "hooks");
  try {
    mkdirSync(hooks, { recursive: true });
    // An older tasker wrote its temp file under this fixed name.
    rmSync(join(hooks, "pre-push.tmp"), { force: true });
    replaceFile(join(hooks, "pre-push"), hookScript(publishTokens), { mode: 0o755, followSymlink: false });
  } catch (error) {
    throw new Error(`cannot install the pre-push hook in the clone: ${clone}`, { cause: error });
  }
}

// Runs `git push <args>` with a new one-time token.
// It deletes the token if the push did not use it.
export async function pushWithToken(
  args: readonly string[],
  options: {
    location: GitLocation;
    publishTokens: string;
    sshKey: string | undefined;
    env: NodeJS.ProcessEnv;
  },
): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const file = join(resolve(options.publishTokens), token);
  mkdirSync(options.publishTokens, { recursive: true, mode: 0o700 });
  writeFileSync(file, "", { flag: "wx", mode: 0o600 });
  try {
    await runRemoteGit(
      ["push", ...args],
      { ...options.location, env: { ...options.env, TASKER_PUBLISH_TOKEN: token } },
      options.sshKey,
    );
  } finally {
    rmSync(file, { force: true });
  }
}
