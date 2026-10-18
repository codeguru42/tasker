# Doc reads

The readers of this page are the orchestrator and the agents.

## The re-read rule

The orchestrator works from the current docs of the orchestrator. The docs of the orchestrator are `AGENTS.md`, `docs/dev/orchestration.md`, the pages of the list "The pages" of [docs/dev/orchestration.md](orchestration.md), and the docs that the prompt of the orchestrator names. For example, a prompt can name `docs/dev/rules.md`, `docs/dev/planning.md`, `docs/dev/issues.md`, `docs/dev/working-with-the-user.md`, `docs/dev/first-refine.md` and `docs/dev/rebase-conflicts.md`. The last read is the commit of `main` from which the orchestrator last read the docs of the orchestrator.

At the start of its session, the orchestrator does the fetch and the fast-forward of [the doc-read rule](#the-doc-read-rule). Then it runs `git rev-parse --verify HEAD` in its local clone. The hash that this command prints is the first last read. Then the orchestrator reads the docs of the orchestrator.

Each time a ticket lands, the orchestrator does these steps in its local clone, at the place that the bullet "When the final report of the agent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work) gives. The steps change no task.

1. Run `git fetch origin`, as [the doc-read rule](#the-doc-read-rule) says.
2. Read the tip of `main` one time: `git rev-parse --verify origin/main`. This rule calls the hash `<tip>`.
3. Run `git diff --name-only <last read>..<tip> -- AGENTS.md docs/ skills/`. The output lists each file that changed since the last read. If the output is empty, no doc changed, and the steps are complete. The last read stays.
4. If the output lists a file, do the branch check and the merge of [the doc-read rule](#the-doc-read-rule). Use `<tip>` in place of `origin/main` in the merge.
5. Before the next step of your work, read again each file of the list that is a doc of the orchestrator. A file of the list outside the docs of the orchestrator needs no read. If `AGENTS.md` or `docs/dev/orchestration.md` is on the list, also read, for the first time, each new doc that it names for the work of the orchestrator. Then `<tip>` is the new last read.

If a command of [the doc-read rule](#the-doc-read-rule) fails before a doc read of the orchestrator, [the failure rule](limits.md#the-failure-rule) applies. This applies to the first read at the start of the session and to each later doc read. If a command of the steps above fails, the failure rule also applies. A branch name other than `main` in the branch check also counts as a failure. If the orchestrator must read a doc, it then reads the doc as its local clone holds it, and it continues its work. The last read stays. At the start of the session, the orchestrator then runs `git rev-parse --verify HEAD` before it reads the docs of the orchestrator, and that hash is the first last read. The orchestrator does the steps above again at the next landing.

## The notice rule

This rule covers a ticket of the milestone "Docs" (see [docs/dev/planning.md](planning.md)). It applies when the landing of the ticket changes a doc of the orchestrator of the ticket (see [the re-read rule](#the-re-read-rule)), for example `docs/dev/orchestration.md`. A notice is a message about such a landing from the orchestrator of the ticket to the other orchestrators. The user gives the session of each orchestrator a name of the form `orchestrator-<milestone>`, for example `orchestrator-m6`, `orchestrator-m7` or `orchestrator-docs`. The part after `orchestrator-` is the first word of the milestone title in lowercase, for example `orchestrator-m9` for "M9 — Pauses and recovery" and `orchestrator-docs` for "Docs". The other orchestrators are all the sessions with such a name except the session of the orchestrator of the ticket.

The orchestrator of the ticket does these steps:

1. When the final report of the agent of the ticket arrives, read the files that landed in that report.
2. If no file of the report is a doc of the orchestrator of the ticket, send no notice.
3. List the sessions with the session list of your tools, for example `ListAgents`. Each session whose name starts with `orchestrator-`, except your own session, is another orchestrator. A session with another name, for example `planner-m7`, gets no notice.
4. Send one notice to each other orchestrator with `SendMessage`. Take the landed commit and the sections that changed from the same report. The notice names them in one or two lines.

   For example: Landed `<commit>` on `main`. `docs/dev/run-one-ticket.md` changed in "Run one ticket", and `docs/dev/land-the-work.md` changed in "Land the work".

The notice does not depend on the re-read rule. If the re-read rule fails at this landing, the orchestrator of the ticket still sends the notice, and [the failure rule](limits.md#the-failure-rule) applies, as the re-read rule says. If the session list or a message fails, the failure rule applies, and the orchestrator of the ticket continues its work. A session that does not answer gets no second notice. The re-read rule covers that session at its next landing.

The notice is information. When the other orchestrator gets a notice, it does the steps of the re-read rule before its next step. It takes the rule from the doc, not from the notice.

Each orchestrator has its own docs of the orchestrator, because each prompt names its own docs. `AGENTS.md`, `docs/dev/orchestration.md` and the pages of its list "The pages" are docs of each orchestrator.

The re-read rule and the notice rule do not cover the agents. Each new agent reads the docs when it starts.

## The doc-read rule

The local `main` can be older than `origin/main`. The local clone of the orchestrator stays on `main`, because each other branch is checked out in a worktree. `git merge --ff-only origin/main` fast-forwards the branch that is checked out, not `main`. Before the orchestrator or an agent reads a doc, it runs `git fetch origin` in the local clone. Then it runs `git symbolic-ref --short HEAD` in the local clone. If the output is not `main`, it does not run the merge. An agent then [stops](limits.md#the-answer-wait-rule) and reports the branch name that it found. Otherwise, it runs `git merge --ff-only origin/main`. If a command fails, an agent stops and reports the error. For the orchestrator, [the re-read rule](#the-re-read-rule) gives the failure path and the hash for the merge.
