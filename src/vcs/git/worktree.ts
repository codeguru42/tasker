import { pathSlug } from "../../issue-key/path-slug.js";

// The task branch: the short ref, then the issue title as a lower-case slug.
export function taskBranchName(shortRef: string, title: string): string {
  return `${shortRef}-${pathSlug(title.toLowerCase())}`;
}
