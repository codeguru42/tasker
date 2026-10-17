import { errorMessage } from "../error-message.js";
import { stopGroup } from "../process/run-group.js";
import { interruptDeadRun, isSpawningState } from "../state/machine.js";
import { pidIsLive } from "../store/pid.js";
import type { Task, TaskStore } from "../store/store.js";
import { taskById } from "./task-state.js";

// Finds out if the run of task is dead. If it is, the step moves the task to interrupted. When the child process of
// the run still runs, the step stops the process group of the child. It gives back the task as the store holds it, and the notes for the user
// (with no line end). A failed stop is a note, never a throw, and the task stays interrupted.
// It takes no task lock. The one transaction of the read and the move is the guard.
export async function handleDeadRun(store: TaskStore, task: Task): Promise<{ task: Task; notes: string[] }> {
  // A task that is not in a spawning state cannot have a dead run, so the step opens no write transaction for it.
  // If another process moves the task into a spawning state after the read, that run is live, so this misses no
  // dead run. For a task in a spawning state, the one transaction of endDeadRun stays the guard.
  if (!isSpawningState(task.state)) return { task, notes: [] };
  const moved = interruptDeadRun(store, task.id);
  // Another command can have moved the task, so the step reads it again.
  if (moved === undefined) return { task: taskById(store, task.id), notes: [] };
  const notes = [`note: the run of ${task.issueKey} died in ${moved.from}; the task is now interrupted`];
  const { childPid } = moved;
  if (childPid !== null && pidIsLive(childPid)) {
    try {
      await stopGroup(childPid);
      notes.push(`note: stopped the process group ${childPid} of the dead run`);
    } catch (error) {
      notes.push(`note: cannot stop the process group ${childPid} of the dead run: ${errorMessage(error)}`);
    }
  }
  return { task: moved.task, notes };
}
