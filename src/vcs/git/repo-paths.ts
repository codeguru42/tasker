import { join } from "node:path";
import { dataRootLayout } from "../../store/layout.js";

export interface RepoPaths {
  clone: string;
  publishTokens: string;
  worktrees: string;
}

// The usual limit for a file name, in bytes.
const MAX_SLUG_BYTES = 255;

// A folder name for a repo key. Each byte of the key that is a-z, 0-9 or "-" stays.
// Each other byte becomes "_" and two lower-case hex digits. As a result, no two keys
// share a slug, also on a case-insensitive file system.
export function repoSlug(repoKey: string): string {
  if (repoKey === "") {
    throw new Error("cannot make a repo slug from an empty repo key");
  }
  let slug = "";
  for (const byte of Buffer.from(repoKey, "utf8")) {
    const char = String.fromCharCode(byte);
    slug += /[a-z0-9-]/.test(char) ? char : `_${byte.toString(16).padStart(2, "0")}`;
  }
  if (Buffer.byteLength(slug) > MAX_SLUG_BYTES) {
    throw new Error(`the repo key is too long for a folder name: ${repoKey}`);
  }
  return slug;
}

// The folders of one repo under dataRoot. It only computes paths and makes no folder.
export function repoPaths(dataRoot: string, repoKey: string): RepoPaths {
  const layout = dataRootLayout(dataRoot);
  const slug = repoSlug(repoKey);
  return {
    clone: join(layout.clones, slug, "repo.git"),
    publishTokens: join(layout.clones, slug, "publish-tokens"),
    worktrees: join(layout.worktrees, slug),
  };
}
