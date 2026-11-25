---
name: orchestrator-set
description: Load this template when the user starts an orchestrator with a set scope, or you change that first prompt.
placeholders:
  SLUG: The slug of the scope, as docs/dev/GLOSSARY.md defines it.
  ISSUE_KEYS: The list text of the issue keys that the user writes, for example "A, B and C" for three keys.
---
You are orchestrator-{{SLUG}}. Your scope is the issues {{ISSUE_KEYS}}. Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/orchestrator.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/orchestrator.md with git show origin/main:<path>. Read each start doc in full before any other work. Then start.