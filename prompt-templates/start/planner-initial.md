---
name: planner-initial
description: Load this template when the user starts the initial planner of a milestone, or you change that first prompt.
placeholders:
  MILESTONE: The title of the milestone.
---
You are the planner of {{MILESTONE}}. Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/planner.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/planner.md with git show origin/main:<path>. This is the initial planning: the user works with you in this tab. After the start reads, read the title and the description of the milestone. Then start the drafts of its issues.