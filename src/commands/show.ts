import type { RegisterCommand } from "../cli.js";
import { showLines } from "../state/commands.js";
import { formatFindings } from "../review/findings-text.js";
import {
  transitionFromEvents,
  lastTransitionError,
  pauseRecordOf,
  type PauseRecord,
  type TaskState,
} from "../state/machine.js";
import type { ExecuteTodoProgress, Task, TaskEvent, TaskStore } from "../store/store.js";
import { resetIsoTime } from "../tasks/run-outcome.js";
import { vcsForRepo } from "../vcs/provider.js";
import {
  formatColumns,
  formatFields,
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  oneLine,
  REPO_OPTION_DESCRIPTION,
  withIssueTask,
} from "./shared.js";

const TODO_STATE_LABELS: Record<ExecuteTodoProgress["state"], string> = {
  done: "done",
  in_progress: "in progress",
  not_started: "not started",
};

// The todos of the pinned revision with their states, then the state of its fix turn.
// The text is empty when the task has no pinned revision, or when no todo of it has a recorded state.
function todoProgress(store: TaskStore, taskId: number): string {
  const pinned = store.pinnedPlanRevision(taskId);
  if (pinned === undefined) return "";
  const progress = store.executeTodoProgress(taskId, pinned.version);
  if (progress.every(({ state }) => state === "not_started")) return "";
  const rows = progress.map(({ todo, state }) => [TODO_STATE_LABELS[state], todo.id, oneLine(todo.title)]);
  const lines = formatColumns(rows).map((line) => `  ${line}\n`);
  const fixTurn = store.executeFixTurnState(taskId, pinned.version);
  const fixTurnLine = fixTurn === undefined ? "" : `fix turn: ${fixTurn}\n`;
  return `todos (approved v${pinned.version}):\n${lines.join("")}${fixTurnLine}`;
}

// The findings of the latest review, for a task in reviewed. The text is empty in each other state.
function reviewFindings(store: TaskStore, task: Task): string {
  if (task.state !== "reviewed") return "";
  const review = store.latestReview(task.id);
  if (review === undefined) return "";
  return `review findings (review ${review.number}, at ${review.revision}):\n${formatFindings(review.findings)}`;
}

type Field = [string, string | number | undefined];

const resetsAtField = (record: PauseRecord): Field => [
  "resets at",
  record.resetsAt === undefined ? undefined : resetIsoTime(record.resetsAt),
];

const causeField = (record: PauseRecord): Field => ["cause", record.cause];

// The fields of each pause state, from the state before the pause and the facts of the pause.
const PAUSE_FIELDS: Partial<Record<string, (origin: TaskState | undefined, record: PauseRecord) => Field[]>> = {
  quota_blocked: (origin, record) => [["paused from", origin], causeField(record), resetsAtField(record)],
  awaiting_quota_approval: (origin, record) => [
    ["paused from", origin],
    ["utilization", record.utilization],
    resetsAtField(record),
  ],
  interrupted: (origin, record) => [
    ["paused from", origin],
    record.cause === "signal" && record.signal !== undefined
      ? ["cause", `signal ${record.signal}`]
      : causeField(record),
  ],
};

// The facts of the pause of a task in quota_blocked, awaiting_quota_approval or interrupted, from the last move into
// the pause. Each other state has no such facts.
function pauseFields(events: readonly TaskEvent[], state: string): Field[] {
  const fieldsOf = PAUSE_FIELDS[state];
  if (fieldsOf === undefined) return [];
  const pause = state as TaskState;
  return fieldsOf(transitionFromEvents(events, pause), pauseRecordOf(events, pause));
}

function formatTask(store: TaskStore, task: Task, clone: string): string {
  const events = store.listEvents(task.id);
  const last = events.at(-1);
  const fields: [string, string | number | null | undefined][] = [
    ["issue", task.issueKey],
    ["repo", task.repoKey],
    ["title", task.title],
    ["state", task.state],
    ["attempt", task.attempt],
    ["base", task.base],
    ["branch", task.branch],
    ["worktree", task.worktreePath],
    ["clone", clone],
    ["created", task.createdAt],
    ["updated", task.updatedAt],
    ["last event", last && `${last.at} ${last.type} ${JSON.stringify(last.data)}`],
  ];
  if (task.state === "failed") {
    fields.push(
      ["failed in", transitionFromEvents(events, "failed")],
      ["error", lastTransitionError(events, "failed")],
    );
  }
  fields.push(...pauseFields(events, task.state));
  const commandLines = showLines(task.state, task.issueKey)
    .map((line) => `${line}\n`)
    .join("");
  return formatFields(fields) + commandLines + todoProgress(store, task.id) + reviewFindings(store, task);
}

export const show: RegisterCommand = (program, io) => {
  program
    .command("show")
    .description("Print the details of the task of an issue: the active task, else the newest one")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      io.stdout(
        await withIssueTask(io, config, issue, { repo: options.repo }, (store, task) => {
          const { vcs, ctx } = vcsForRepo(config, task.repoKey, process.env);
          return formatTask(store, task, vcs.localCopyPath(ctx));
        }),
      );
    });
};
