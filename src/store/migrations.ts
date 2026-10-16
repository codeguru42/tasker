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
  `CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT
);
CREATE INDEX events_task_id ON events (task_id, id);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;`,
  `CREATE TABLE default_base_branches (
  repo_key TEXT PRIMARY KEY,
  branch TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `ALTER TABLE tasks ADD COLUMN title TEXT;
ALTER TABLE tasks ADD COLUMN short_ref TEXT;
ALTER TABLE tasks ADD COLUMN base TEXT;
ALTER TABLE tasks ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX tasks_active_repo_issue ON tasks (repo_key, issue_key)
  WHERE state NOT IN ('finished', 'cancelled');`,
  `CREATE TABLE locks (
  name TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  acquired_at TEXT NOT NULL
);`,
  `CREATE TABLE run_markers (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id),
  state TEXT NOT NULL,
  pid INTEGER NOT NULL,
  child_pid INTEGER,
  started_at TEXT NOT NULL
);`,
  `CREATE TABLE plan_revisions (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  version INTEGER NOT NULL,
  source TEXT NOT NULL,
  feedback TEXT,
  answer TEXT NOT NULL,
  prompt TEXT NOT NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, version)
);`,
  `CREATE TABLE sessions (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX sessions_task_plan ON sessions (task_id, role) WHERE role = 'plan';`,
  `ALTER TABLE sessions ADD COLUMN plan_version INTEGER;
CREATE UNIQUE INDEX sessions_task_execute ON sessions (task_id, plan_version) WHERE role = 'execute';
CREATE TABLE execute_todos (
  task_id INTEGER NOT NULL,
  plan_version INTEGER NOT NULL,
  todo_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in_progress', 'done')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, plan_version, todo_id),
  FOREIGN KEY (task_id, plan_version) REFERENCES plan_revisions (task_id, version)
);
CREATE TABLE execute_fix_turns (
  task_id INTEGER NOT NULL,
  plan_version INTEGER NOT NULL,
  verify_failure TEXT NOT NULL,
  verify_log_tail TEXT,
  queued_at TEXT NOT NULL,
  done_at TEXT,
  PRIMARY KEY (task_id, plan_version),
  FOREIGN KEY (task_id, plan_version) REFERENCES plan_revisions (task_id, version)
);`,
  `CREATE TABLE verify_runs (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  number INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('passed', 'failed', 'timed_out', 'dirty_before', 'dirty_after')),
  commands TEXT NOT NULL,
  failing_command INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  PRIMARY KEY (task_id, number)
);`,
  `CREATE TABLE reviews (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  number INTEGER NOT NULL,
  revision TEXT NOT NULL,
  prompt TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  PRIMARY KEY (task_id, number)
);
CREATE TABLE review_findings (
  task_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  file TEXT NOT NULL,
  line INTEGER,
  category TEXT,
  summary TEXT NOT NULL,
  failure_scenario TEXT NOT NULL,
  dismissed_at TEXT,
  dismiss_reason TEXT,
  PRIMARY KEY (task_id, number, position),
  FOREIGN KEY (task_id, number) REFERENCES reviews (task_id, number),
  CHECK ((dismissed_at IS NULL) = (dismiss_reason IS NULL))
);
ALTER TABLE sessions ADD COLUMN review_number INTEGER;
CREATE UNIQUE INDEX sessions_task_review ON sessions (task_id, review_number) WHERE role = 'review';`,
  `CREATE TABLE quota_events (
  repo_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event TEXT NOT NULL,
  received_at TEXT NOT NULL
);`,
];
