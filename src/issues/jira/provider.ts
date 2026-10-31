import type { IssueProvider } from "../provider.js";

// Stub: the green commit replaces it.
export function createJiraProvider({ site }: { site: string | undefined }): IssueProvider {
  throw new Error(`not implemented: ${String(site)}`);
}
