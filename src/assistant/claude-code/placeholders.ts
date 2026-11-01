import type { PlaceholderList } from "../placeholders.js";

// The placeholders that bwrap leaves, measured on claude 2.1.289 and 2.1.299. bwrap makes an empty
// read-only file for each protected path that does not exist. A killed claude leaves all of them.
// A normal exit still leaves .claude/.cc-writes and .claude.
const ROOT_FILES = [
  ".bash_profile",
  ".bashrc",
  ".gitconfig",
  ".gitmodules",
  ".idea",
  ".mcp.json",
  ".profile",
  ".ripgreprc",
  ".vscode",
  ".zprofile",
  ".zshrc",
];
const CLAUDE_ENTRIES = [
  "agents",
  "commands",
  "hooks",
  "skills",
  "workflows",
  "routines",
  "output-styles",
  "loop.md",
  "launch.json",
  "scheduled_tasks.json",
  "settings.json",
  "settings.local.json",
];

export const CLAUDE_PLACEHOLDERS: PlaceholderList = {
  rootFiles: ROOT_FILES,
  folder: {
    name: ".claude",
    entries: [
      ...CLAUDE_ENTRIES.map((name) => ({ name, kind: "file-or-folder" as const })),
      { name: ".cc-writes", kind: "folder" as const },
    ],
  },
};
