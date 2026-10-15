import type { RemoteTip } from "./provider.js";

// A message when the tip of the branch on the remote moved from before to after.
// Otherwise undefined.
export function tipMoved(before: RemoteTip, after: RemoteTip): string | undefined {
  const name = (tip: RemoteTip): string => (tip.state === "present" ? tip.revision : "absent");
  if (name(before) === name(after)) {
    return undefined;
  }
  return `the tip of the branch on the remote moved from ${name(before)} to ${name(after)}`;
}
