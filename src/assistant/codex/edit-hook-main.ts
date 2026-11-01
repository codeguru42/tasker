import { readFileSync } from "node:fs";

// Codex lets the patch pass when this script crashes. As a result, the whole script runs in one try, and the
// catch prints a deny line. It loads the hook with import() because a failed static import crashes the script.
try {
  const worktree = process.argv[2];
  if (worktree === undefined) throw new Error("no worktree argument");
  const { editHookAnswer } = await import("./edit-hook.js");
  process.stdout.write(editHookAnswer(readFileSync(0, "utf8"), worktree, process.argv.slice(3)));
} catch {
  process.stdout.write(
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"the codex edit hook failed"}}\n',
  );
}
