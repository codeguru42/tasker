// The reason that tasker gives for a set TASKER_PI_CODING_AGENT_SESSION_DIR that is not absolute.
export function relativeSessionFolderReason(value: string): string {
  return `TASKER_PI_CODING_AGENT_SESSION_DIR must be an absolute path, got ${value}`;
}
