import { join } from "node:path";
import { pathSlug } from "../../issue-key/path-slug.js";
import { dataRootLayout } from "../../store/layout.js";

export interface RepoPaths {
  clone: string;
  publishTokens: string;
  worktrees: string;
}

// The usual limit for a file name, in bytes.
const MAX_SLUG_BYTES = 255;

// A folder name for a repo key: the path slug of the key, at most MAX_SLUG_BYTES long.
// The slug has only ASCII characters, so one character is one byte.
export function repoSlug(repoKey: string): string {
  const slug = pathSlug(repoKey);
  if (slug.length > MAX_SLUG_BYTES) {
    throw new Error(`the repo key is too long for a folder name: ${repoKey}`);
  }
  return slug;
}

// The folders of one repo under dataRoot. It only computes paths and makes no folder.
export function repoPaths(dataRoot: string, repoKey: string): RepoPaths {
  const layout = dataRootLayout(dataRoot);
  const slug = repoSlug(repoKey);
  return {
    // The name must not end in .git. docs/dev/version-control.md (Sandbox write paths) gives the reason.
    clone: join(layout.clones, slug, "bare-repo"),
    publishTokens: join(layout.clones, slug, "publish-tokens"),
    worktrees: join(layout.clones, slug, "worktrees"),
  };
}
