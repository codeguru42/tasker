import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { shellQuote } from "./ssh.js";

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
  const temp = join(hooks, "pre-push.tmp");
  try {
    mkdirSync(hooks, { recursive: true });
    writeFileSync(temp, hookScript(publishTokens), { mode: 0o755 });
    // The umask can remove bits from the mode of writeFileSync.
    chmodSync(temp, 0o755);
    renameSync(temp, join(hooks, "pre-push"));
  } catch (error) {
    throw new Error(`cannot install the pre-push hook in the clone: ${clone}`, { cause: error });
  }
}
