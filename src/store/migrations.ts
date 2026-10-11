// Append a new SQL string for each schema version. Never edit an old one.
export const migrations: readonly string[] = [
  `CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  issue_key TEXT NOT NULL,
  repo_key TEXT NOT NULL,
  state TEXT NOT NULL,
  branch TEXT,
  worktree_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tasks_repo_issue ON tasks (repo_key, issue_key);`,
];
