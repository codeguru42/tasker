# Doc reads

The readers of this page are the orchestrator and the agents.

## The re-read rule

The orchestrator works from the current docs. The docs are `AGENTS.md` and the docs that `AGENTS.md` names. The last read is the commit of `main` from which the orchestrator last read the docs.

At the start of its session, the orchestrator does the fetch and the fast-forward of [the doc-read rule](#the-doc-read-rule). Then it runs `git rev-parse --verify HEAD` in its local clone. The hash that this command prints is the first last read. Then the orchestrator reads the docs.

Each time a ticket lands, the orchestrator does these steps in its local clone, at the place that the bullet "When the final report of the agent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work) gives. The steps change no task.

1. Run `git fetch origin`, as [the doc-read rule](#the-doc-read-rule) says.
2. Read the tip of `main` one time: `git rev-parse --verify origin/main`. This rule calls the hash `<tip>`. Use `<tip>`, not `origin/main`, in the next steps, as [the shared-clone rule](orchestration.md#the-shared-clone-rule) says.
3. Run `git diff --name-only <last read>..<tip> -- AGENTS.md docs/ skills/`. The output lists each file that changed since the last read. If the output is empty, no doc changed, and the steps are complete. The last read stays.
4. If the output lists a file, do the branch check and the merge of [the doc-read rule](#the-doc-read-rule). Use `<tip>` in place of `origin/main` in the merge.
5. Before the next step of your work, read again each file of the list that is `AGENTS.md` or a doc that `AGENTS.md` names. If `AGENTS.md` is on the list, also read each doc that `AGENTS.md` names for the first time. Then `<tip>` is the new last read.

If a command of [the doc-read rule](#the-doc-read-rule) fails before a doc read of the orchestrator, the orchestrator tells the user the command and the error. This applies to the first read at the start of the session and to each later doc read. If a command of the steps above fails, the orchestrator also tells the user the command and the error. A branch name other than `main` in the branch check also counts as a failure. If the orchestrator must read a doc, it then reads the doc as its local clone holds it, and it continues its work. The last read stays. At the start of the session, the orchestrator then runs `git rev-parse --verify HEAD` before it reads the docs, and that hash is the first last read. The orchestrator does the steps above again at the next landing.

## The notice rule

This rule covers a ticket of the milestone "Docs" (see [docs/dev/planning.md](planning.md)). It applies when the landing of the ticket changes one of the docs of the re-read rule, for example `docs/dev/orchestration.md`. A notice is a message about such a landing from the orchestrator of the ticket to the other orchestrators. The user gives the session of each orchestrator a name of the form `orchestrator-<milestone>`, for example `orchestrator-m6`, `orchestrator-m7` or `orchestrator-docs`. The part after `orchestrator-` is the first word of the milestone title in lowercase, for example `orchestrator-m9` for "M9 — Pauses and recovery" and `orchestrator-docs` for "Docs". The other orchestrators are all the sessions with such a name except the session of the orchestrator of the ticket.

The orchestrator of the ticket does these steps:

1. When the final report of the agent of the ticket arrives, read the files that landed in that report.
2. If no file of the report is one of the docs of the re-read rule, send no notice.
3. List the sessions with the session list of your tools, for example `ListAgents`. Each session whose name starts with `orchestrator-`, except your own session, is another orchestrator. A session with another name, for example `planner-m7`, gets no notice.
4. Send one notice to each other orchestrator with `SendMessage`. Take the landed commit and the sections that changed from the same report. The notice names them in one or two lines.

   For example: Landed `<commit>` on `main`. `docs/dev/run-one-ticket.md` changed in "Run one ticket", and `docs/dev/land-the-work.md` changed in "Land the work".

The notice does not depend on the re-read rule. If the re-read rule fails at this landing, the orchestrator of the ticket still sends the notice, and it tells the user the failed command and the error, as the re-read rule says. If the session list or a message fails, the orchestrator of the ticket tells the user the tool and the error, and it continues its work. A session that does not answer gets no second notice. The re-read rule covers that session at its next landing.

The notice is information. When the other orchestrator gets a notice, it does the steps of the re-read rule before its next step. It takes the rule from the doc, not from the notice.

The re-read rule and the notice rule do not cover the agents. Each new agent reads the docs when it starts.

## The doc-read rule

The local `main` can be older than `origin/main`. The local clone of the orchestrator stays on `main`, because each other branch is checked out in a worktree. `git merge --ff-only origin/main` fast-forwards the branch that is checked out, not `main`. Before the orchestrator or an agent reads a doc, it runs `git fetch origin` in the local clone. Then it runs `git symbolic-ref --short HEAD` in the local clone. If the output is not `main`, it does not run the merge. An agent then stops and reports the branch name that it found to the orchestrator. Otherwise, it runs `git merge --ff-only origin/main`. If a command fails, an agent stops and reports the error to the orchestrator. After each stop of this rule, an agent waits as [the answer-wait rule](orchestration.md#the-answer-wait-rule) says. For the orchestrator, [the re-read rule](#the-re-read-rule) gives the failure path and the hash for the merge.
