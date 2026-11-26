---
name: orchestrator
description: Load this template when an old orchestrator writes the prompt of its handoff file, or you change that prompt.
placeholders:
  SCOPE: The scope, "the milestone <title>" for a milestone scope or "a set of issues" for a set scope.
  HANDOFF_PATH: The full path of the handoff file.
  SESSION_NAME: The session name of the new orchestrator, orchestrator-<slug>.
  FIRST_FREE_ITEM_ID: The first free item id, as "The last item id" of docs/dev/handoff.md says.
  EXTRA_DOCS: "Extra docs: " and each extra doc with a final period, or empty if the prompt has no extra doc.
  OPEN_ISSUES: "Open issues: " and the open issue keys joined as "A, B and C" with a final period, or empty for a milestone scope.
---
Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/orchestrator.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/orchestrator.md with git show origin/main:<path>.
You are the new orchestrator after a handoff. Your scope is {{SCOPE}}.
{{OPEN_ISSUES}}
Your session name is {{SESSION_NAME}}.
Your handoff file is {{HANDOFF_PATH}}.
Your first free item id is {{FIRST_FREE_ITEM_ID}}.
{{EXTRA_DOCS}}
Then do your steps of "The start of the new orchestrator" in docs/dev/handoff-orchestrator.md. Do "The check of the handoff folder" of docs/dev/handoff.md at the time that section gives.